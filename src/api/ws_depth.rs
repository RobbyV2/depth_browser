use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use std::time::Instant;
use tracing::{error, info};

use super::depth::{SharedDepthModel, run_depth_inference};

/// WebSocket upgrade handler for /ws/depth
pub async fn ws_depth_handler(
    ws: WebSocketUpgrade,
    State(model): State<SharedDepthModel>,
) -> Response {
    ws.on_upgrade(move |socket| handle_depth_socket(socket, model))
}

/// Handle the WebSocket connection
async fn handle_depth_socket(socket: WebSocket, model: SharedDepthModel) {
    let (mut sender, mut receiver) = socket.split();

    info!("[WS-DEPTH] Client connected");

    while let Some(msg) = receiver.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                error!("[WS-DEPTH] Receive error: {}", e);
                break;
            }
        };

        match msg {
            Message::Binary(jpeg_bytes) => {
                let start = Instant::now();

                match run_depth_inference(&model, jpeg_bytes).await {
                    Ok(depth_bytes) => {
                        let rtt = start.elapsed().as_millis();
                        info!("[WS-DEPTH] Inference RTT: {}ms", rtt);

                        if let Err(e) = sender.send(Message::Binary(depth_bytes)).await {
                            error!("[WS-DEPTH] Send error: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        error!("[WS-DEPTH] Inference error: {}", e);
                        // Send error message
                        let _ = sender.send(Message::Text(format!("error: {}", e))).await;
                    }
                }
            }
            Message::Text(text) => {
                // Handle text messages (e.g., ping/config)
                if text == "ping" {
                    let _ = sender.send(Message::Text("pong".to_string())).await;
                }
            }
            Message::Ping(data) => {
                let _ = sender.send(Message::Pong(data)).await;
            }
            Message::Close(_) => {
                info!("[WS-DEPTH] Client disconnected");
                break;
            }
            _ => {}
        }
    }

    info!("[WS-DEPTH] Connection closed");
}
