use axum::Router;

/// Register all API routes here
/// Routes are automatically mapped from src/api/ structure
pub fn register_routes() -> Router {
    Router::new()
        .merge(crate::api::hello::routes())
        .merge(crate::api::greet::routes())
        .merge(crate::api::search::routes())
        .merge(crate::api::create::routes())
        .merge(crate::api::env::routes())
}
