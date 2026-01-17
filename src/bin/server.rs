use axum::http::{HeaderName, Method, header};
use depth_browser::server::build_router;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env.local first, then fall back to .env
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // CORS configuration with WebSocket support
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::UPGRADE,
            header::CONNECTION,
            HeaderName::from_static("sec-websocket-key"),
            HeaderName::from_static("sec-websocket-version"),
            HeaderName::from_static("sec-websocket-protocol"),
        ])
        .allow_credentials(true);

    // Cross-Origin Isolation headers (required for SharedArrayBuffer used by Scramjet)
    let coop_header = SetResponseHeaderLayer::overriding(
        HeaderName::from_static("cross-origin-opener-policy"),
        header::HeaderValue::from_static("same-origin"),
    );
    let coep_header = SetResponseHeaderLayer::overriding(
        HeaderName::from_static("cross-origin-embedder-policy"),
        header::HeaderValue::from_static("require-corp"),
    );

    let app = build_router()
        .await
        .layer(cors)
        .layer(coop_header)
        .layer(coep_header);

    // Read host and port from environment variables
    let host = std::env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("SERVER_PORT").unwrap_or_else(|_| "3030".to_string());
    let addr = format!("{}:{}", host, port);

    let listener = tokio::net::TcpListener::bind(&addr).await?;

    let app_name = std::env::var("APP_NAME").unwrap_or_else(|_| "DepthXR-Browser".to_string());

    info!("Starting {}", app_name);
    info!("Listening on http://{}", addr);
    info!("Wisp proxy available at ws://{}/wisp/", addr);

    // Graceful shutdown handler
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("Server shutdown complete");

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("Received Ctrl+C signal, initiating graceful shutdown...");
        },
        _ = terminate => {
            info!("Received terminate signal, initiating graceful shutdown...");
        },
    }
}
