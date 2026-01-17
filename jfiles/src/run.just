import "../common.just"

# Run commands

# Run development mode (Rust + Next.js dev server)
dev:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"
  echo "Building WASM (dev)..."
  wasm-pack build --target web --out-dir public/wasm --dev
  trap 'kill 0' SIGINT
  cargo run --bin server 2>&1 | sed 's/^/[API] /' &
  sleep 2
  bun run dev 2>&1 | sed 's/^/[WEB] /' &
  wait

# Run Rust API server (development)
api:
  cd {{ROOT}} && cargo run --bin server

# Run Rust API server (release mode)
api-release:
  cd {{ROOT}} && cargo run --bin server --release

# Run Next.js dev server
frontend:
  cd {{ROOT}} && bun run dev

# Run Next.js production server
frontend-prod:
  cd {{ROOT}} && bun start

