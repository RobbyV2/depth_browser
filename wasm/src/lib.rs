use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
    console_log::init_with_level(log::Level::Debug).expect("Failed to initialize logger");
    log::info!("WASM module initialized");
}

/// Greet function - example WASM export
#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! (from Rust WASM)", name)
}

/// Add two numbers - example WASM export
#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
