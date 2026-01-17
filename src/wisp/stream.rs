//! Stream handling for proxied TCP/UDP connections

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::str::FromStr;

use anyhow::{Context, Result};
use bytes::Bytes;
use futures::{Sink, SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::select;
use tracing::{debug, trace};
use wisp_mux::WispError;
use wisp_mux::packet::{CloseReason, ConnectPacket, StreamType};
use wisp_mux::stream::MuxStream;

use super::config::WispConfig;
use super::resolver::get_resolver;

/// Result of resolving a connection request
pub enum ResolvedStream {
    /// Valid TCP/UDP connection
    Valid(ConnectPacket),
    /// No addresses resolved
    NoResolvedAddrs,
    /// Connection blocked by policy
    Blocked,
    /// Invalid request
    Invalid,
}

/// An active client stream (TCP or UDP)
pub enum ClientStream {
    Tcp(TcpStream),
    Udp(UdpSocket),
}

// IP validation helpers
fn ipv4_is_private(addr: Ipv4Addr) -> bool {
    addr.is_private() || addr.is_loopback() || addr.is_link_local()
}

fn ipv6_is_private(addr: Ipv6Addr) -> bool {
    addr.is_loopback()
        || (addr.segments()[0] & 0xfe00) == 0xfc00 // Unique local
        || (addr.segments()[0] & 0xffc0) == 0xfe80 // Link local
}

fn is_private(addr: IpAddr) -> bool {
    match addr {
        IpAddr::V4(v4) => ipv4_is_private(v4),
        IpAddr::V6(v6) => ipv6_is_private(v6),
    }
}

/// Resolve a connection packet to a valid address
pub async fn resolve_packet(packet: &ConnectPacket, config: &WispConfig) -> Result<ResolvedStream> {
    // Check stream type
    match packet.stream_type {
        StreamType::Tcp if !config.allow_tcp => return Ok(ResolvedStream::Blocked),
        StreamType::Udp if !config.allow_udp => return Ok(ResolvedStream::Blocked),
        StreamType::Other(_) => return Ok(ResolvedStream::Invalid),
        _ => {}
    }

    // Check blocked ports
    if config.is_port_blocked(packet.port) {
        debug!("Port {} is blocked", packet.port);
        return Ok(ResolvedStream::Blocked);
    }

    // Try to parse as direct IP first
    if let Ok(ip) = IpAddr::from_str(&packet.host) {
        if ip.is_loopback() && !config.allow_loopback {
            return Ok(ResolvedStream::Blocked);
        }
        if is_private(ip) && !config.allow_private {
            return Ok(ResolvedStream::Blocked);
        }
        return Ok(ResolvedStream::Valid(packet.clone()));
    }

    // Resolve hostname
    let resolver = get_resolver();
    let addrs = resolver.resolve(&packet.host).await?;

    // Find a valid address
    for addr in addrs {
        if addr.is_loopback() && !config.allow_loopback {
            continue;
        }
        if is_private(addr) && !config.allow_private {
            continue;
        }

        return Ok(ResolvedStream::Valid(ConnectPacket {
            stream_type: packet.stream_type,
            host: addr.to_string(),
            port: packet.port,
        }));
    }

    Ok(ResolvedStream::NoResolvedAddrs)
}

/// Connect to the resolved address
pub async fn connect_stream(packet: &ConnectPacket) -> Result<ClientStream> {
    let ip: IpAddr = packet
        .host
        .parse()
        .with_context(|| format!("Invalid IP address: {}", packet.host))?;

    match packet.stream_type {
        StreamType::Tcp => {
            let stream = TcpStream::connect(SocketAddr::new(ip, packet.port))
                .await
                .with_context(|| format!("Failed to connect to {}:{}", packet.host, packet.port))?;

            // Enable TCP_NODELAY for lower latency
            let _ = stream.set_nodelay(true);

            Ok(ClientStream::Tcp(stream))
        }
        StreamType::Udp => {
            let bind_addr = if ip.is_ipv4() {
                SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), 0)
            } else {
                SocketAddr::new(Ipv6Addr::UNSPECIFIED.into(), 0)
            };

            let socket = UdpSocket::bind(bind_addr)
                .await
                .context("Failed to bind UDP socket")?;

            socket
                .connect(SocketAddr::new(ip, packet.port))
                .await
                .with_context(|| {
                    format!("Failed to connect UDP to {}:{}", packet.host, packet.port)
                })?;

            Ok(ClientStream::Udp(socket))
        }
        StreamType::Other(_) => anyhow::bail!("Unsupported stream type"),
    }
}

/// Forward data between a MuxStream and a TCP stream
pub async fn forward_tcp<W>(mux: MuxStream<W>, mut tcp: TcpStream, buffer_size: usize) -> Result<()>
where
    W: Sink<Bytes, Error = WispError> + Send + Unpin + 'static,
{
    let closer = mux.get_close_handle();

    let result: Result<()> = async {
        let (mut mux_read, mut mux_write) = mux.into_split();
        let (mut tcp_read, mut tcp_write) = tcp.split();

        let mut tcp_buf = vec![0u8; buffer_size];

        loop {
            select! {
                // MuxStream -> TCP
                data = mux_read.next() => {
                    match data {
                        Some(Ok(data)) => {
                            tcp_write.write_all(&data).await?;
                        }
                        Some(Err(e)) => {
                            trace!("MuxStream read error: {:?}", e);
                            break;
                        }
                        None => break,
                    }
                }
                // TCP -> MuxStream
                result = tcp_read.read(&mut tcp_buf) => {
                    match result {
                        Ok(0) => break,
                        Ok(n) => {
                            mux_write.send(Bytes::copy_from_slice(&tcp_buf[..n])).await
                                .map_err(|e| anyhow::anyhow!("MuxStream write error: {:?}", e))?;
                        }
                        Err(e) => {
                            trace!("TCP read error: {:?}", e);
                            break;
                        }
                    }
                }
            }
        }

        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            let _ = closer.close(CloseReason::Voluntary).await;
        }
        Err(_) => {
            let _ = closer.close(CloseReason::Unexpected).await;
        }
    }

    Ok(())
}

/// Forward data between a MuxStream and a UDP socket
pub async fn forward_udp<W>(mux: MuxStream<W>, socket: UdpSocket) -> Result<()>
where
    W: Sink<Bytes, Error = WispError> + Send + Unpin + 'static,
{
    let closer = mux.get_close_handle();
    let (mut mux_read, mut mux_write) = mux.into_split();

    let result: Result<()> = async {
        let mut udp_buf = vec![0u8; 65507]; // Max UDP packet size

        loop {
            select! {
                // MuxStream -> UDP
                data = mux_read.next() => {
                    match data {
                        Some(Ok(data)) => {
                            socket.send(&data).await?;
                        }
                        Some(Err(e)) => {
                            trace!("MuxStream read error: {:?}", e);
                            break;
                        }
                        None => break,
                    }
                }
                // UDP -> MuxStream
                result = socket.recv(&mut udp_buf) => {
                    match result {
                        Ok(n) => {
                            mux_write.send(Bytes::copy_from_slice(&udp_buf[..n])).await
                                .map_err(|e| anyhow::anyhow!("MuxStream write error: {:?}", e))?;
                        }
                        Err(e) => {
                            trace!("UDP recv error: {:?}", e);
                            break;
                        }
                    }
                }
            }
        }

        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            let _ = closer.close(CloseReason::Voluntary).await;
        }
        Err(_) => {
            let _ = closer.close(CloseReason::Unexpected).await;
        }
    }

    Ok(())
}
