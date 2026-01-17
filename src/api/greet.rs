use axum::{Router, extract::Path, response::Json, routing::get};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct ApiResponse {
    message: String,
}

/// Define routes for this endpoint
/// Path: /api/greet/:name
pub fn routes() -> Router {
    Router::new().route("/api/greet/:name", get(handler))
}

async fn handler(Path(name): Path<String>) -> Json<ApiResponse> {
    Json(ApiResponse {
        message: format!("Hello, {}!", name),
    })
}
