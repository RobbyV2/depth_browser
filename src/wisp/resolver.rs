//! DNS resolution utilities

use std::net::IpAddr;
use std::sync::OnceLock;

use anyhow::{Context, Result};
use hickory_resolver::TokioResolver;
use hickory_resolver::config::{NameServerConfigGroup, ResolverConfig};
use hickory_resolver::name_server::TokioConnectionProvider;
use tracing::warn;

static RESOLVER: OnceLock<Resolver> = OnceLock::new();

pub enum Resolver {
    Hickory(Box<TokioResolver>),
    System,
}

impl Resolver {
    /// Resolve a hostname to IP addresses
    pub async fn resolve(&self, host: &str) -> Result<Vec<IpAddr>> {
        match self {
            Self::Hickory(resolver) => {
                let lookup = resolver
                    .lookup_ip(host)
                    .await
                    .with_context(|| format!("Failed to resolve hostname: {}", host))?;
                Ok(lookup.into_iter().collect())
            }
            Self::System => {
                let addrs: Vec<_> = tokio::net::lookup_host(format!("{}:0", host))
                    .await
                    .with_context(|| format!("Failed to resolve hostname: {}", host))?
                    .map(|x| x.ip())
                    .collect();
                Ok(addrs)
            }
        }
    }
}

/// Initialize the global DNS resolver
pub fn init_resolver(dns_servers: &[String]) {
    RESOLVER.get_or_init(|| {
        if dns_servers.is_empty() {
            // Try to use system DNS
            match hickory_resolver::system_conf::read_system_conf() {
                Ok((config, opts)) => Resolver::Hickory(Box::new(
                    TokioResolver::builder_with_config(config, TokioConnectionProvider::default())
                        .with_options(opts)
                        .build(),
                )),
                Err(_) => {
                    warn!("Unable to read system DNS config, using system resolver");
                    Resolver::System
                }
            }
        } else {
            // Parse configured DNS servers
            let servers: Vec<IpAddr> = dns_servers.iter().filter_map(|s| s.parse().ok()).collect();

            if servers.is_empty() {
                warn!("No valid DNS servers configured, using system resolver");
                return Resolver::System;
            }

            let config = ResolverConfig::from_parts(
                None,
                Vec::new(),
                NameServerConfigGroup::from_ips_clear(&servers, 53, true),
            );

            Resolver::Hickory(Box::new(
                TokioResolver::builder_with_config(config, TokioConnectionProvider::default())
                    .build(),
            ))
        }
    });
}

/// Get the global resolver
pub fn get_resolver() -> &'static Resolver {
    RESOLVER.get_or_init(|| {
        // Default initialization if not explicitly initialized
        if RESOLVER.get().is_none() {
            init_resolver(&[]);
        }
        // Return a default Resolver if somehow still not initialized
        Resolver::System
    })
}
