use axum::{Router, http::StatusCode, response::Json, routing::post};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Serialize)]
struct ApiResponse {
    message: String,
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct CreateRequest {
    name: String,
}

/// Define routes for this endpoint
/// Path: /api/create
pub fn routes() -> Router {
    Router::new().route("/api/create", post(handler))
}

async fn handler(Json(payload): Json<CreateRequest>) -> Result<Json<ApiResponse>, StatusCode> {
    if payload.name.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(Json(ApiResponse {
        message: format!("Created: {}", payload.name),
        data: Some(json!({
            "id": 1,
            "name": payload.name
        })),
    }))
}
