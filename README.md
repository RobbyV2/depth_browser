# DepthXR Browser

Real-time depth estimation and 3D visualization for screen capture. Captures any window/screen and renders it as a depth-displaced 3D mesh.

## Features

- Screen/window capture via getDisplayMedia
- Client-side depth estimation using WebGPU (@huggingface/transformers)
- Server-side depth estimation using PyTorch (CUDA, ROCm, DirectML)
- Real-time 3D visualization with Three.js/React Three Fiber
- Multiple depth filter modes (nearest, linear, quantized, contrast, bilateral)

## Prerequisites

- Rust (stable)
- Node.js 18+ and Bun
- Python 3.11 (for server-side depth with DirectML) or 3.12 (for ROCm)
- just command runner
- wasm-pack

## Quick Start

```
just src::dev
```

Opens at http://localhost:3030

## Depth Modes

### Client-Side (WebGPU)

Runs in browser using your GPU via WebGPU. No server setup required. Works on any modern browser with WebGPU support.

### Server-Side (PyTorch)

Runs on the Rust server using PyTorch. Requires Python setup. Faster with dedicated GPU.

## GPU Setup

### Check Current Status

```
just src::check-gpu
```

### NVIDIA (CUDA)

```
just src::setup-python-cuda
```

### AMD Options

RX 7000/9000 series (ROCm native):

```
just src::setup-amd-rocm
```

Any AMD GPU (DirectML, requires Python 3.11):

```
just src::setup-amd-directml
```

ZLUDA (experimental):

```
just src::setup-amd-zluda
```

### Running with DirectML

```
just src::dev-dml
```

## Environment Variables

Create `.env.local`:

```
SERVER_PORT=3030
SERVER_HOST=127.0.0.1
SERVER_PROXY_URL=http://127.0.0.1:3031

NEXT_PUBLIC_DEPTH_INFERENCE_BASE=384
NEXT_PUBLIC_DEPTH_TARGET_FPS=15
NEXT_PUBLIC_DEPTH_FILTER_MODE=nearest
```

## Project Structure

```
app/
  page.tsx              Main UI
  components/
    DepthScene.tsx      3D visualization (R3F)
  lib/
    depth-pipeline.ts   Client-side depth (WebGPU)
    depth-server.ts     Server-side WebSocket client

src/
  api/
    depth.rs            PyO3 depth model wrapper
    ws_depth.rs         WebSocket handler
  server/
    route_builder.rs    Route registration
  bin/
    server.rs           Main entry point

python/
  depth_estimator.py    PyTorch depth inference
  requirements.txt      Python dependencies
  check_gpu.py          GPU detection script

jfiles/src/
  run.just              Dev/prod commands
  build.just            Build commands
  python.just           Python/GPU setup commands
```

## Commands

```
just                         List all commands
just src::dev                Run dev servers (Rust + Next.js)
just src::dev-dml            Run with DirectML venv
just src::build-all          Build for production
just src::check-gpu          Check GPU availability
just src::setup-python       Install Python deps (CPU)
just src::setup-python-cuda  Install with CUDA
just src::setup-amd-directml Install with DirectML (Python 3.11)
just src::setup-amd-rocm     Install with ROCm
```

## Architecture

```
Browser (3030) --> Rust/Axum --> Next.js (3031)
                      |
                      v
              WebSocket /ws/depth
                      |
                      v
              PyO3 --> Python/PyTorch
```

Rust server is the main entry point. It handles API routes and WebSocket connections, proxying frontend requests to Next.js.

## Filter Modes

- nearest: Sharp edges, no interpolation
- linear: Smooth interpolation
- linear-mipmap: Smooth with mipmaps
- quantized: Discrete depth levels
- contrast: Enhanced mid-range contrast
- bilateral: Edge-preserving smoothing

Select filter mode in the UI dropdown during capture.

## License

MIT
