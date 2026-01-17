use axum::{Router, extract::Query, http::StatusCode, response::Json, routing::get};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Serialize)]
struct ApiResponse {
    message: String,
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct SearchParams {
    q: Option<String>,
}

/// Define routes for this endpoint
/// Path: /api/search
pub fn routes() -> Router {
    Router::new().route("/api/search", get(handler))
}

async fn handler(Query(params): Query<SearchParams>) -> Result<Json<ApiResponse>, StatusCode> {
    let query = params.q.ok_or(StatusCode::BAD_REQUEST)?;

    if query.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(Json(ApiResponse {
        message: format!("Search results for: {}", query),
        data: Some(json!({
            "query": query,
            "results": []
        })),
    }))
}
