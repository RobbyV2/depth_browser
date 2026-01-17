use axum::{
    Router,
    extract::Request,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use tower_http::services::ServeDir;

use crate::wisp::{WispState, wisp_ws_handler};

/// Proxy non-API requests to Next.js dev server
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
    // Create Wisp state
    let wisp_state = WispState::default();

    // Get paths to npm package static assets
    let scramjet_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/node_modules/@mercuryworkshop/scramjet/dist"
    );
    let baremux_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/node_modules/@mercuryworkshop/bare-mux/dist"
    );
    let libcurl_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/node_modules/@mercuryworkshop/libcurl-transport/dist"
    );

    Router::new()
        // Wisp WebSocket endpoint
        .route("/wisp/", get(wisp_ws_handler).with_state(wisp_state))
        // Scramjet static assets (served directly by Axum)
        .nest_service("/scram", ServeDir::new(scramjet_path))
        .nest_service("/baremux", ServeDir::new(baremux_path))
        .nest_service("/libcurl", ServeDir::new(libcurl_path))
        // Fallback: proxy everything else to Next.js
        .fallback(proxy_to_nextjs)
}
