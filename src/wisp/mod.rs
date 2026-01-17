//! Wisp protocol server implementation for proxying TCP/UDP connections.
//!
//! This module provides a WebSocket-based proxy server using the Wisp protocol.
//! It allows web clients to establish TCP and UDP connections through the server.

mod config;
mod handler;
mod resolver;
mod stream;

pub use config::WispConfig;
pub use handler::{WispState, wisp_ws_handler};
