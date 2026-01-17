use axum::{Router, response::Json, routing::get};
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Serialize)]
struct ApiResponse {
    message: String,
    data: Option<Value>,
}

/// Define routes for this endpoint
/// Path: /api/hello
pub fn routes() -> Router {
    Router::new().route("/api/hello", get(handler))
}

async fn handler() -> Json<ApiResponse> {
    Json(ApiResponse {
        message: "Hello from Rust API!".to_string(),
        data: Some(json!({
            "status": "success",
            "version": "1.0.0"
        })),
    })
}
