use axum::{
    Router,
    extract::Request,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use std::path::PathBuf;
use tower_http::services::ServeDir;

use crate::api::depth::init_depth_model;
use crate::api::ws_depth::ws_depth_handler;

/// Find the models directory
fn find_models_dir() -> PathBuf {
    // Try relative to executable
    if let Ok(exe) = std::env::current_exe() {
        let exe_dir = exe.parent().unwrap_or(&exe);
        let models_dir = exe_dir.join("models").join("onnx");
        if models_dir.exists() {
            return models_dir;
        }
        // Try parent (cargo run)
        if let Some(parent) = exe_dir.parent() {
            let models_dir = parent.join("models").join("onnx");
            if models_dir.exists() {
                return models_dir;
            }
        }
    }
    // Fall back to current directory
    PathBuf::from("./models/onnx")
}

/// Proxy requests to Next.js dev server
async fn proxy_to_nextjs(mut req: Request) -> Response {
    let proxy_url =
        std::env::var("SERVER_PROXY_URL").unwrap_or_else(|_| "http://127.0.0.1:3031".to_string());

    let proxy_uri = match proxy_url.parse::<hyper::Uri>() {
        Ok(uri) => uri,
        Err(e) => {
            tracing::error!("Invalid proxy URL {}: {}", proxy_url, e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid proxy configuration",
            )
                .into_response();
        }
    };

    let path = req.uri().path();
    let path_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or(path);

    let new_uri = format!("{}{}", proxy_url, path_query);
    match new_uri.parse() {
        Ok(uri) => *req.uri_mut() = uri,
        Err(e) => {
            tracing::error!("Failed to parse URI {}: {}", new_uri, e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Invalid URI").into_response();
        }
    }

    if let Some(host) = proxy_uri.host() {
        let host_value = if let Some(port) = proxy_uri.port_u16() {
            format!("{}:{}", host, port)
        } else {
            host.to_string()
        };
        if let Ok(header_value) = host_value.parse() {
            req.headers_mut().insert(hyper::header::HOST, header_value);
        }
    }

    let client = Client::builder(TokioExecutor::new()).build_http();

    match client.request(req).await {
        Ok(response) => response.into_response(),
        Err(e) => {
            tracing::error!("Proxy error: {}", e);
            (StatusCode::BAD_GATEWAY, "Frontend server not available").into_response()
        }
    }
}

/// Register all routes
pub async fn register_routes() -> Router {
    // Initialize depth model at startup
    let depth_model = init_depth_model().await;

    // Setup ONNX model serving
    let models_dir = find_models_dir();
    tracing::info!("[MODELS] Serving ONNX models from {:?}", models_dir);

    Router::new()
        // WebSocket depth inference route
        .route("/ws/depth", get(ws_depth_handler))
        .with_state(depth_model)
        // Serve ONNX models for client-side inference
        .nest_service("/models", ServeDir::new(&models_dir))
        // Fallback to Next.js proxy
        .fallback(proxy_to_nextjs)
}
