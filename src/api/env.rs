use axum::{Router, response::Json, routing::get};
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Serialize)]
struct EnvResponse {
    message: String,
    data: Value,
}

/// Define routes for this endpoint
/// Path: /api/env
/// Demonstrates reading environment variables in Rust
pub fn routes() -> Router {
    Router::new().route("/api/env", get(handler))
}

async fn handler() -> Json<EnvResponse> {
    let app_name = std::env::var("APP_NAME").unwrap_or_else(|_| "not set".to_string());
    let app_env = std::env::var("APP_ENV").unwrap_or_else(|_| "not set".to_string());
    let api_host = std::env::var("API_HOST").unwrap_or_else(|_| "not set".to_string());
    let api_port = std::env::var("API_PORT").unwrap_or_else(|_| "not set".to_string());
    let secret_key = std::env::var("SECRET_KEY").unwrap_or_else(|_| "not set".to_string());

    // Don't expose the full secret, just confirm it exists
    let secret_status = if secret_key != "not set" {
        format!(
            "Set ({}...)",
            &secret_key.chars().take(3).collect::<String>()
        )
    } else {
        "Not set".to_string()
    };

    Json(EnvResponse {
        message: "Environment variables from Rust".to_string(),
        data: json!({
            "APP_NAME": app_name,
            "APP_ENV": app_env,
            "API_HOST": api_host,
            "API_PORT": api_port,
            "SECRET_KEY": secret_status,
        }),
    })
}
