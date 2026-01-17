use axum::Router;

pub mod route_builder;

pub async fn build_router() -> Router {
    route_builder::register_routes().await
}
