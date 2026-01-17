//! Wisp server configuration

use std::ops::RangeInclusive;

/// Configuration for the Wisp proxy server
#[derive(Debug, Clone)]
pub struct WispConfig {
    /// Allow UDP streams
    pub allow_udp: bool,
    /// Allow TCP streams
    pub allow_tcp: bool,
    /// Allow connections to loopback addresses
    pub allow_loopback: bool,
    /// Allow connections to private/non-global IPs
    pub allow_private: bool,
    /// Buffer size for stream copying
    pub buffer_size: usize,
    /// Blocked ports
    pub blocked_ports: Vec<RangeInclusive<u16>>,
    /// DNS servers to use (empty = system default)
    pub dns_servers: Vec<String>,
}

impl Default for WispConfig {
    fn default() -> Self {
        Self {
            allow_udp: true,
            allow_tcp: true,
            allow_loopback: false,
            allow_private: true,
            buffer_size: 16384,
            blocked_ports: vec![
                // Common blocked ports for security
                22..=22,   // SSH
                25..=25,   // SMTP
                587..=587, // SMTP submission
            ],
            dns_servers: vec!["1.1.1.1".to_string(), "8.8.8.8".to_string()],
        }
    }
}

impl WispConfig {
    /// Check if a port is blocked
    pub fn is_port_blocked(&self, port: u16) -> bool {
        self.blocked_ports.iter().any(|range| range.contains(&port))
    }
}
