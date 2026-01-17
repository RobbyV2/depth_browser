use rust_next::server::build_router;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env.local first, then fall back to .env
    // dotenvy::from_filename returns an error if file doesn't exist, which is fine
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = build_router().layer(cors);

    // Read host and port from environment variables
    let host = std::env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("API_PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("{}:{}", host, port);

    let listener = tokio::net::TcpListener::bind(&addr).await?;

    let app_name = std::env::var("APP_NAME").unwrap_or_else(|_| "rust-next".to_string());
    let app_env = std::env::var("APP_ENV").unwrap_or_else(|_| "development".to_string());

    info!("Starting {} ({})", app_name, app_env);
    info!("Rust API server listening on http://{}", addr);

    axum::serve(listener, app).await?;

    Ok(())
}
