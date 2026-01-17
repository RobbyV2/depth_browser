# rust-next

Next.js frontend with Rust backend API server using file-system based routing.

## Branches

- **main**: The active development branch (Rust Backend + Next.js Frontend).
- **static**: Rust WASM + Next.js (no backend server). Ideal for static hosting.
- **single-server**: A variation with a single server setup.

## Architecture

This template uses a two-server architecture where Rust is the main entry point:

- **Rust Server** (Port 3000) - Main entry point handling API routes
- **Next.js Server** (Port 3001) - Frontend with hot reload in dev, optimized build in production
- Rust proxies non-API requests to Next.js
- Browser connects to `http://localhost:3000` for everything

## Features

- **Rust Backend**: Fast, type-safe API server using Axum
- **Rust WASM**: Client-side Rust code via WebAssembly
- **Next.js Frontend**: Modern React framework with TypeScript
- **Single Port Access**: All requests go through Rust server on port 3000
- **CORS Handling**: Automatic CORS configuration
- **Hot Reload**: Development mode with Next.js hot module replacement
- **Production Ready**: Standalone Next.js build for optimal performance

## Quick Start

### Prerequisites

- Rust (latest stable)
- Node.js 18+
- [Bun](https://bun.sh/) (v1.0+)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [just](https://github.com/casey/just) command runner

### Development Mode

```bash
just src dev
```

This starts:

- Builds WASM (dev mode)
- Rust server on port 3000
- Next.js dev server on port 3001
- Visit `http://localhost:3000`

### Production Mode

```bash
just src build-all
# Run production servers
./target/release/server    # Terminal 1
bun start                   # Terminal 2
```

## Project Structure

```
.
├── src/
│   ├── api/           # API route handlers
│   ├── server/        # Server configuration and routing
│   └── bin/server.rs  # Main Rust entry point
├── wasm/              # Rust WASM source
│   └── src/lib.rs     # WASM entry point
├── app/
│   ├── lib/           # Frontend utilities and API client
│   ├── page.tsx       # Home page
│   └── layout.tsx     # Root layout
├── Cargo.toml         # Workspace config
├── package.json       # Node.js dependencies
└── justfile          # Build and run commands
```

## WASM Support

The template includes support for Rust WASM modules.

1.  Code is in `wasm/src/lib.rs`
2.  Built to `public/wasm/`
3.  Loaded in frontend using `import` (see `app/wasm/page.tsx` for example)

To build WASM manually:

```bash
just src build-wasm
```

## Environment Variables

Create a `.env.local` file:

```env
SERVER_PORT=3000
SERVER_HOST=127.0.0.1
PORT=3001
HOSTNAME=localhost
RUST_LOG=info
```

For remote access (e.g., Codespaces):

- Set `SERVER_HOST=0.0.0.0`
- Set `HOSTNAME=0.0.0.0` (dev mode only)

## Adding New API Routes

1. Add route handler in `src/api/mod.rs`:

```rust
async fn my_route() -> Json<MyResponse> {
    Json(MyResponse { /* ... */ })
}

pub fn routes() -> Router {
    Router::new()
        .route("/hello", get(hello))
        .route("/my-route", get(my_route))  // Add here
}
```

2. Call from frontend in `app/lib/api.ts`:

```typescript
export async function myRoute(): Promise<MyResponse> {
  const response = await fetch('/api/my-route')
  return handleResponse<MyResponse>(response)
}
```

## Development Commands

### Using Just

```bash
just                        # List all available commands
just src                    # List all src commands

# Development (run.just)
just src dev                # Run BOTH servers together (Bash/WSL/Unix only!)
just src api                # Run Rust API only
just src frontend           # Run Next.js only
just src api-release        # Run Rust API (release mode)
just src frontend-prod      # Run Next.js (production mode)

# Build (build.just)
just src build              # Build Rust for production
just src build-api          # Build Rust API for production
just src build-frontend     # Build Next.js for production
just src build-wasm         # Build WASM module
just src build-all          # Build both for production
just src check              # Check Rust code without building

# Format & Lint (build.just)
just src fmt                # Format and lint ALL code (Rust + TypeScript)
just src fmt-check          # Check formatting without changes
just src fmt-rust           # Format Rust only
just src fmt-ts             # Format TypeScript only

# Test (test.just)
just src test               # Run Rust tests

# Maintenance (justfile)
just src install            # Install dependencies
just src clean              # Clean build artifacts
```

## Tech Stack

### Backend (Rust)

- **axum**: Modern web framework
- **tokio**: Async runtime
- **serde/serde_json**: Serialization
- **tower-http**: HTTP middleware (CORS, tracing)
- **tracing**: Structured logging

### WASM (Rust)

- **wasm-bindgen**: Rust/JS interoperability
- **web-sys**: Web APIs

### Frontend (Next.js)

- **React 19**: UI framework
- **Next.js 16**: React framework with App Router
- **TypeScript**: Type safety

## License

MIT
