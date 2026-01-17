//! Axum WebSocket handler for Wisp protocol

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use bytes::Bytes;
use futures::{Sink, SinkExt, Stream, StreamExt};
use pin_project_lite::pin_project;
// tokio::sync::Mutex removed - using channel-based approach for writes
use tracing::{debug, error, info, trace, warn};
use wisp_mux::packet::CloseReason;
use wisp_mux::{ServerMux, WispError};

use super::config::WispConfig;
use super::resolver::init_resolver;
use super::stream::{
    ClientStream, ResolvedStream, connect_stream, forward_tcp, forward_udp, resolve_packet,
};

/// Application state for the Wisp handler
#[derive(Clone)]
pub struct WispState {
    pub config: Arc<WispConfig>,
}

impl Default for WispState {
    fn default() -> Self {
        let config = WispConfig::default();
        init_resolver(&config.dns_servers);
        Self {
            config: Arc::new(config),
        }
    }
}

/// Axum handler for Wisp WebSocket connections
pub async fn wisp_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<WispState>,
) -> impl IntoResponse {
    info!("New Wisp WebSocket connection");
    ws.on_upgrade(move |socket| handle_wisp_connection(socket, state))
}

/// Handle a single Wisp WebSocket connection
async fn handle_wisp_connection(socket: WebSocket, state: WispState) {
    let id = uuid::Uuid::new_v4().to_string();
    debug!("[{}] Wisp client connected", id);

    if let Err(e) = handle_wisp_inner(socket, state, &id).await {
        error!("[{}] Wisp connection error: {:?}", id, e);
    }

    debug!("[{}] Wisp client disconnected", id);
}

/// Inner handler that returns Result for easier error handling
async fn handle_wisp_inner(socket: WebSocket, state: WispState, id: &str) -> anyhow::Result<()> {
    // Split the WebSocket and wrap with our adapter
    let (ws_write, ws_read) = socket.split();
    let transport = AxumWsTransport::new(ws_read, ws_write);

    // Create the Wisp multiplexor
    let buffer_size = state.config.buffer_size as u32;

    // Split for ServerMux
    let (read, write) = transport.split();

    let (mux, mux_task) = ServerMux::new(read, write, buffer_size, None)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to create ServerMux: {:?}", e))?
        .with_no_required_extensions();

    let mux = Arc::new(mux);

    // Spawn the multiplexor task
    let mux_id = id.to_string();
    tokio::spawn(async move {
        if let Err(e) = mux_task.await {
            trace!("[{}] Mux task ended: {:?}", mux_id, e);
        }
    });

    debug!(
        "[{}] Wisp mux created, extensions: {:?}",
        id,
        mux.get_extension_ids()
    );

    // Handle incoming streams
    while let Some((connect, stream)) = mux.wait_for_stream().await {
        let config = state.config.clone();
        let stream_id = id.to_string();

        tokio::spawn(async move {
            debug!(
                "[{}] Stream requested: {:?}:{}",
                stream_id, connect.host, connect.port
            );

            // Resolve the connection
            match resolve_packet(&connect, &config).await {
                Ok(ResolvedStream::Valid(resolved)) => {
                    debug!(
                        "[{}] Resolved to: {:?}:{}",
                        stream_id, resolved.host, resolved.port
                    );

                    // Connect to the target
                    match connect_stream(&resolved).await {
                        Ok(ClientStream::Tcp(tcp)) => {
                            if let Err(e) = forward_tcp(stream, tcp, config.buffer_size).await {
                                warn!("[{}] TCP forward error: {:?}", stream_id, e);
                            }
                        }
                        Ok(ClientStream::Udp(udp)) => {
                            if let Err(e) = forward_udp(stream, udp).await {
                                warn!("[{}] UDP forward error: {:?}", stream_id, e);
                            }
                        }
                        Err(e) => {
                            warn!("[{}] Connect error: {:?}", stream_id, e);
                            let _ = stream.close(CloseReason::ServerStreamUnreachable).await;
                        }
                    }
                }
                Ok(ResolvedStream::NoResolvedAddrs) => {
                    debug!("[{}] No resolved addresses", stream_id);
                    let _ = stream.close(CloseReason::ServerStreamUnreachable).await;
                }
                Ok(ResolvedStream::Blocked) => {
                    debug!("[{}] Connection blocked by policy", stream_id);
                    let _ = stream.close(CloseReason::ServerStreamBlockedAddress).await;
                }
                Ok(ResolvedStream::Invalid) => {
                    debug!("[{}] Invalid stream request", stream_id);
                    let _ = stream.close(CloseReason::ServerStreamInvalidInfo).await;
                }
                Err(e) => {
                    warn!("[{}] Resolution error: {:?}", stream_id, e);
                    let _ = stream.close(CloseReason::ServerStreamUnreachable).await;
                }
            }
        });
    }

    // Close the mux
    let _ = mux.close().await;

    Ok(())
}

// ============================================================================
// WebSocket Transport Adapter
// ============================================================================

pin_project! {
    /// Combined transport that implements both Stream and Sink for wisp-mux
    pub struct AxumWsTransport {
        #[pin]
        read: futures_util::stream::SplitStream<WebSocket>,
        write: futures_util::stream::SplitSink<WebSocket, Message>,
    }
}

impl AxumWsTransport {
    pub fn new(
        read: futures_util::stream::SplitStream<WebSocket>,
        write: futures_util::stream::SplitSink<WebSocket, Message>,
    ) -> Self {
        Self { read, write }
    }

    /// Split into separate read and write parts for ServerMux
    pub fn split(self) -> (AxumWsRead, AxumWsWrite) {
        (
            AxumWsRead { inner: self.read },
            AxumWsWrite::new(self.write),
        )
    }
}

// Read adapter
pin_project! {
    pub struct AxumWsRead {
        #[pin]
        inner: futures_util::stream::SplitStream<WebSocket>,
    }
}

impl Stream for AxumWsRead {
    type Item = Result<Bytes, WispError>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.project();
        match this.inner.poll_next(cx) {
            Poll::Ready(Some(Ok(msg))) => match msg {
                Message::Binary(data) => Poll::Ready(Some(Ok(data.into()))),
                Message::Text(text) => Poll::Ready(Some(Ok(Bytes::from(text.into_bytes())))),
                Message::Close(_) => Poll::Ready(None),
                Message::Ping(_) | Message::Pong(_) => {
                    // Continue polling for the next message
                    cx.waker().wake_by_ref();
                    Poll::Pending
                }
            },
            Poll::Ready(Some(Err(e))) => Poll::Ready(Some(Err(WispError::WsImplError(Box::new(
                std::io::Error::other(e.to_string()),
            ))))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}

// Write adapter using a channel for proper ordering
pub struct AxumWsWrite {
    tx: tokio::sync::mpsc::UnboundedSender<WriteCommand>,
}

enum WriteCommand {
    Send(Bytes),
    Close,
}

impl AxumWsWrite {
    fn new(write: futures_util::stream::SplitSink<WebSocket, Message>) -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<WriteCommand>();

        // Spawn a task to handle writes in order
        tokio::spawn(async move {
            let mut write = write;
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    WriteCommand::Send(data) => {
                        if let Err(e) = write.send(Message::Binary(data.to_vec())).await {
                            trace!("WebSocket send error: {:?}", e);
                            break;
                        }
                    }
                    WriteCommand::Close => {
                        let _ = write.send(Message::Close(None)).await;
                        let _ = write.close().await;
                        break;
                    }
                }
            }
        });

        Self { tx }
    }
}

impl Clone for AxumWsWrite {
    fn clone(&self) -> Self {
        Self {
            tx: self.tx.clone(),
        }
    }
}

impl Sink<Bytes> for AxumWsWrite {
    type Error = WispError;

    fn poll_ready(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        // Channel-based approach is always ready (unbounded)
        Poll::Ready(Ok(()))
    }

    fn start_send(self: Pin<&mut Self>, item: Bytes) -> Result<(), Self::Error> {
        // Send through the channel - this maintains ordering
        self.tx.send(WriteCommand::Send(item)).map_err(|_| {
            WispError::WsImplError(Box::new(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "WebSocket write channel closed",
            )))
        })
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        // Channel handles the actual flushing asynchronously
        Poll::Ready(Ok(()))
    }

    fn poll_close(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        let _ = self.tx.send(WriteCommand::Close);
        Poll::Ready(Ok(()))
    }
}
