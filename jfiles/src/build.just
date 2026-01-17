import "../common.just"

# Build commands

# Build Rust for production (optimized)
build:
  cd {{ROOT}} && cargo build --release

# Build WASM module
build-wasm:
  cd {{ROOT}} && wasm-pack build --target web --out-dir public/wasm --release

# Build WASM for development
build-wasm-dev:
  cd {{ROOT}} && wasm-pack build --target web --out-dir public/wasm --dev

# Build the API server binary for production
build-api:
  cd {{ROOT}} && cargo build --release --bin server

# Build Next.js for production
build-frontend:
  cd {{ROOT}} && bun run build
  @echo "Copying static assets for standalone build..."
  cd {{ROOT}} && cp -r .next/static .next/standalone/.next/static
  cd {{ROOT}} && cp -r public .next/standalone/public

# Build everything for production
build-all: build-wasm build-api build-frontend
  @echo "Production build complete!"
  @echo "API binary: {{ROOT}}/target/release/server"
  @echo "WASM: {{ROOT}}/public/wasm/"
  @echo "Frontend: {{ROOT}}/.next"

# Check Rust code without building
check:
  cd {{ROOT}} && cargo check

# Format and lint all code (Rust + TypeScript)
fmt:
  cd {{ROOT}} && cargo clippy --all-targets --all-features --fix --allow-dirty -- -D warnings
  cd {{ROOT}} && cargo fmt --all
  cd {{ROOT}} && taplo fmt
  cd {{ROOT}} && bun run lint --fix
  cd {{ROOT}} && bunx prettier --write "**/*.{ts,tsx,js,jsx,json,md}"

# Check formatting and linting without making changes
fmt-check:
  cd {{ROOT}} && cargo fmt --check --all
  cd {{ROOT}} && cargo clippy --all-targets --all-features -- -D warnings
  cd {{ROOT}} && taplo fmt --check
  cd {{ROOT}} && bun run lint
  cd {{ROOT}} && bunx prettier --check "**/*.{ts,tsx,js,jsx,json,md}"

# Format Rust only
fmt-rust:
  cd {{ROOT}} && cargo clippy --all-targets --all-features --fix --allow-dirty -- -D warnings
  cd {{ROOT}} && cargo fmt --all
  cd {{ROOT}} && taplo fmt

# Format TypeScript/Next.js only
fmt-ts:
  cd {{ROOT}} && bun run lint --fix
  cd {{ROOT}} && bunx prettier --write "**/*.{ts,tsx,js,jsx,json,md}"

# Clean build artifacts
clean:
  cd {{ROOT}} && cargo clean
  cd {{ROOT}} && rm -rf .next node_modules/.cache public/wasm
