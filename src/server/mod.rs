use axum::Router;

pub mod route_builder;

pub fn build_router() -> Router {
    route_builder::register_routes()
}
