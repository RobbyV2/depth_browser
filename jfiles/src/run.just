import "../common.just"

# Run commands

# === DEVELOPMENT MODE ===
# Rust server on SERVER_PORT (3030) - main entry point, proxies to Next.js
# Next.js dev server on PORT (3031) - internal, hot reload

# Run development mode (Rust + Next.js dev server)
dev:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  echo "Building WASM (dev)..."
  wasm-pack build wasm --target web --out-dir ../public/wasm --dev

  trap 'kill 0' SIGINT

  # Start Next.js dev server (internal)
  echo "Starting Next.js dev server on port 3031..."
  PORT=3031 HOSTNAME=127.0.0.1 bun next dev 2>&1 | sed 's/^/[WEB] /' &
  sleep 2

  # Start Rust server (main entry point)
  echo "Starting Rust server on port 3030..."
  SERVER_PORT=3030 SERVER_PROXY_URL=http://127.0.0.1:3031 cargo run --bin server 2>&1 | sed 's/^/[RUST] /' &

  echo ""
  echo "==================================="
  echo "Running at:"
  echo "  http://localhost:3030"
  echo "==================================="
  echo ""

  wait

# Run Rust server only (with proxy to Next.js)
api:
  cd {{ROOT}} && SERVER_PROXY_URL=http://127.0.0.1:3031 cargo run --bin server

# Run Rust server (release mode)
api-release:
  cd {{ROOT}} && SERVER_PROXY_URL=http://127.0.0.1:3031 cargo run --bin server --release

# Run Next.js dev server only (internal)
frontend:
  cd {{ROOT}} && PORT=3031 HOSTNAME=127.0.0.1 bun next dev

# === PRODUCTION MODE ===
# Build and run production
prod:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  echo "Building WASM..."
  wasm-pack build wasm --target web --out-dir ../public/wasm --release

  echo "Building frontend..."
  bun run build

  echo "Copying static files for standalone..."
  cp -r public .next/standalone/ 2>/dev/null || true
  cp -r .next/static .next/standalone/.next/ 2>/dev/null || true

  echo "Building backend..."
  cargo build --release --bin server

  echo "Starting servers..."
  trap 'kill 0' SIGINT

  PORT=3031 HOSTNAME=127.0.0.1 bun run ./.next/standalone/server.js 2>&1 | sed 's/^/[WEB] /' &
  sleep 2
  SERVER_PORT=3030 SERVER_PROXY_URL=http://127.0.0.1:3031 ./target/release/server 2>&1 | sed 's/^/[RUST] /' &

  wait

# Run Next.js production server (internal)
frontend-prod:
  cd {{ROOT}} && PORT=3031 bun start
