import "../common.just"

# Python environment management for server-side depth

# Detect OS
os := if os_family() == "windows" { "windows" } else { "linux" }

# Venv paths differ by OS
venv_activate := if os == "windows" { "Scripts/activate" } else { "bin/activate" }
venv_python := if os == "windows" { "Scripts/python.exe" } else { "bin/python" }

# Setup Python dependencies for server depth (CPU only)
setup-python:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  echo "Setting up Python dependencies for DepthXR..."

  PYTHON_DIR="{{ROOT}}/python"

  if [ ! -f "$PYTHON_DIR/requirements.txt" ]; then
    echo "ERROR: requirements.txt not found at $PYTHON_DIR/requirements.txt"
    exit 1
  fi

  # Find pip command
  if command -v pip3 &> /dev/null; then
    PIP="pip3"
  elif command -v pip &> /dev/null; then
    PIP="pip"
  else
    echo "ERROR: pip not found. Install Python first."
    exit 1
  fi

  echo "Using: $PIP"
  echo "Installing from: $PYTHON_DIR/requirements.txt"

  $PIP install -r "$PYTHON_DIR/requirements.txt"

  echo ""
  echo "Python setup complete!"

# Check if Python deps are installed
check-python:
  #!/usr/bin/env bash
  set -euo pipefail

  # Check for ONNX Runtime (primary path) or torch (legacy path)
  if python3 -c "import onnxruntime as ort; print(f'onnxruntime {ort.__version__}')" 2>/dev/null; then
    echo "Python dependencies OK (ONNX Runtime)"
  elif python -c "import onnxruntime as ort; print(f'onnxruntime {ort.__version__}')" 2>/dev/null; then
    echo "Python dependencies OK (ONNX Runtime)"
  elif python3 -c "import torch; print(f'torch {torch.__version__}')" 2>/dev/null; then
    echo "Python dependencies OK (PyTorch)"
  elif python -c "import torch; print(f'torch {torch.__version__}')" 2>/dev/null; then
    echo "Python dependencies OK (PyTorch)"
  else
    echo "Python dependencies NOT installed"
    echo "Run: just src::setup-onnx-directml  (recommended)"
    echo " or: just src::setup-python"
    exit 1
  fi

# Run server with Python deps check
dev-server: check-python
  cd {{ROOT}} && cargo run --bin server

# Check GPU availability (CUDA, ROCm, DirectML)
check-gpu:
  cd {{ROOT}}/python && python check_gpu.py

# === NVIDIA CUDA ===

# Setup PyTorch with CUDA support (for NVIDIA GPUs)
setup-nvidia-cuda:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  echo "Installing PyTorch with CUDA support..."
  echo "Note: Requires NVIDIA GPU + CUDA drivers installed"

  # Find pip
  if command -v pip3 &> /dev/null; then
    PIP="pip3"
  else
    PIP="pip"
  fi

  # Uninstall CPU torch first
  $PIP uninstall -y torch torchvision 2>/dev/null || true

  # Install CUDA 12.4 version (adjust cu124 for your CUDA version)
  $PIP install torch torchvision --index-url https://download.pytorch.org/whl/cu124

  # Install other deps
  $PIP install transformers pillow numpy

  echo ""
  echo "Verifying CUDA..."
  python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"

# === AMD GPU OPTIONS ===

# Setup PyTorch with AMD ROCm - Linux (official AMD support)
setup-amd-rocm-linux:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  if [[ "{{os}}" == "windows" ]]; then
    echo "This command is for Linux. On Windows, use: just src::setup-amd-rocm-windows"
    exit 1
  fi

  echo "Installing PyTorch with AMD ROCm support (Linux)..."
  echo "Requirements:"
  echo "  - AMD GPU with ROCm support (RX 6000/7000 series, MI series)"
  echo "  - ROCm 6.0+ installed"
  echo ""

  PIP=$(command -v pip3 || command -v pip)

  # Uninstall existing torch
  $PIP uninstall -y torch torchvision torchaudio 2>/dev/null || true

  # Install PyTorch with ROCm (ROCm 6.2)
  $PIP install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm6.2

  # Install other deps
  $PIP install transformers pillow numpy

  echo ""
  just src::check-gpu

# Setup PyTorch with AMD ROCm - Windows (RX 7000/9000 series only)
setup-amd-rocm-windows:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  if [[ "{{os}}" != "windows" ]]; then
    echo "This command is for Windows. On Linux, use: just src::setup-amd-rocm-linux"
    exit 1
  fi

  echo "Installing PyTorch with AMD ROCm support (Windows)..."
  echo "Requirements:"
  echo "  - AMD RX 7000 or 9000 series GPU"
  echo "  - AMD driver version 25.20.01.17 or later"
  echo "  - Python 3.12"
  echo ""

  # Find pip
  PIP=$(command -v pip3 || command -v pip)

  # Uninstall existing torch
  $PIP uninstall -y torch torchvision torchaudio 2>/dev/null || true

  # Install ROCm SDK
  echo "Installing ROCm SDK..."
  $PIP install --no-cache-dir \
    https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_core-0.1.dev0-py3-none-win_amd64.whl \
    https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_devel-0.1.dev0-py3-none-win_amd64.whl \
    https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm_sdk_libraries_custom-0.1.dev0-py3-none-win_amd64.whl \
    https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/rocm-0.1.dev0.tar.gz

  # Install PyTorch with ROCm
  echo "Installing PyTorch with ROCm..."
  $PIP install --no-cache-dir \
    https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/torch-2.9.0+rocmsdk20251116-cp312-cp312-win_amd64.whl \
    https://repo.radeon.com/rocm/windows/rocm-rel-7.1.1/torchvision-0.24.0+rocmsdk20251116-cp312-cp312-win_amd64.whl

  # Install other deps
  $PIP install transformers pillow numpy

  echo ""
  just src::check-gpu

# Setup ONNX Runtime (auto-detect platform)
# Windows: DirectML, Linux: CUDA or CPU
setup-onnx:
  #!/usr/bin/env bash
  set -euo pipefail

  if [[ "{{os}}" == "windows" ]]; then
    just src::setup-onnx-directml
  else
    just src::setup-onnx-cuda
  fi

# Setup ONNX Runtime with CUDA (Linux/cross-platform)
setup-onnx-cuda:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  VENV_DIR=".venv-onnx"

  # Create venv if needed
  if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python venv..."
    python3 -m venv "$VENV_DIR"
  fi

  source "$VENV_DIR/{{venv_activate}}"

  echo "Installing ONNX Runtime..."
  python -m pip install --upgrade pip
  python -m pip install pillow numpy huggingface_hub PyTurboJPEG

  # Install CUDA version if available, otherwise CPU
  if python -c "import torch; print(torch.cuda.is_available())" 2>/dev/null | grep -q "True"; then
    echo "CUDA detected, installing onnxruntime-gpu..."
    python -m pip install onnxruntime-gpu
  else
    echo "No CUDA, installing CPU onnxruntime..."
    python -m pip install onnxruntime
  fi

  # Install libjpeg-turbo for TurboJPEG (Linux)
  if [[ "{{os}}" != "windows" ]]; then
    if ! python -c "from turbojpeg import TurboJPEG; TurboJPEG()" 2>/dev/null; then
      echo ""
      echo "Installing libjpeg-turbo system package..."
      if command -v apt-get &> /dev/null; then
        sudo apt-get install -y libturbojpeg0-dev || echo "Could not install libturbojpeg (optional)"
      elif command -v dnf &> /dev/null; then
        sudo dnf install -y turbojpeg-devel || echo "Could not install turbojpeg (optional)"
      elif command -v pacman &> /dev/null; then
        sudo pacman -S --noconfirm libjpeg-turbo || echo "Could not install libjpeg-turbo (optional)"
      else
        echo "Please install libjpeg-turbo manually for your distro (optional)"
      fi
    fi
  fi

  echo ""
  echo "Verifying installation..."
  python -c "import onnxruntime as ort; print(f'ONNX Runtime: {ort.__version__}'); print(f'Providers: {ort.get_available_providers()}')"
  python -c "from turbojpeg import TurboJPEG; TurboJPEG(); print('TurboJPEG: OK')" 2>/dev/null || echo "TurboJPEG: not available (optional)"

  echo ""
  echo "Downloading models..."
  python python/download_models.py

  echo ""
  echo "==========================================="
  echo "ONNX Runtime ready!"
  echo ""
  echo "Run server with:  just src::dev-onnx"
  echo "==========================================="

# Setup ONNX Runtime with DirectML - FAST inference (recommended)
# Works with any DirectX 12 GPU (AMD/Intel/NVIDIA)
setup-onnx-directml:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  if [[ "{{os}}" != "windows" ]]; then
    echo "DirectML is Windows-only. On Linux, use CUDA or ROCm."
    exit 1
  fi

  VENV_DIR=".venv-dml"
  TJPEG_VERSION="3.1.0"
  TJPEG_DIR="$VENV_DIR/libjpeg-turbo"

  # Create venv if needed
  if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python venv..."
    python -m venv "$VENV_DIR"
  fi

  source "$VENV_DIR/{{venv_activate}}"

  echo "Installing ONNX Runtime with DirectML..."
  python -m pip install --upgrade pip
  python -m pip install pillow numpy huggingface_hub PyTurboJPEG
  python -m pip install onnxruntime-directml

  # Install libjpeg-turbo for TurboJPEG (Windows)
  if [ ! -f "$TJPEG_DIR/bin/turbojpeg.dll" ]; then
    echo ""
    echo "Installing libjpeg-turbo $TJPEG_VERSION..."
    mkdir -p "$TJPEG_DIR"

    TJPEG_URL="https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/${TJPEG_VERSION}/libjpeg-turbo-${TJPEG_VERSION}-vc64.exe"
    TJPEG_EXE="$TJPEG_DIR/installer.exe"

    curl -L -o "$TJPEG_EXE" "$TJPEG_URL"

    # Extract using 7z (Git for Windows has it at /usr/bin/7z or via PATH)
    SEVENZIP=""
    if command -v 7z &> /dev/null; then
      SEVENZIP="7z"
    elif [ -f "/usr/bin/7z" ]; then
      SEVENZIP="/usr/bin/7z"
    elif [ -f "/mingw64/bin/7z.exe" ]; then
      SEVENZIP="/mingw64/bin/7z.exe"
    fi

    if [ -n "$SEVENZIP" ]; then
      "$SEVENZIP" x -o"$TJPEG_DIR" "$TJPEG_EXE" -y > /dev/null
    else
      # Run NSIS installer via cmd (silent mode)
      TJPEG_DIR_WIN=$(cygpath -w "$(pwd)/$TJPEG_DIR")
      cmd //c "$(cygpath -w "$TJPEG_EXE") /S /D=$TJPEG_DIR_WIN"
      sleep 3
    fi
    rm -f "$TJPEG_EXE"
  fi

  # Add turbojpeg.dll to venv Scripts (so it's in PATH when venv is active)
  if [ -f "$TJPEG_DIR/bin/turbojpeg.dll" ]; then
    cp "$TJPEG_DIR/bin/turbojpeg.dll" "$VENV_DIR/Scripts/"
    echo "TurboJPEG: installed"
  fi

  echo ""
  echo "Verifying installation..."
  python -c "import onnxruntime as ort; print(f'ONNX Runtime: {ort.__version__}'); print(f'Providers: {ort.get_available_providers()}')"
  python -c "from turbojpeg import TurboJPEG; TurboJPEG(); print('TurboJPEG: OK')" 2>/dev/null || echo "TurboJPEG: not available (optional)"

  echo ""
  echo "Downloading models..."
  python python/download_models.py

  echo ""
  echo "==========================================="
  echo "ONNX Runtime + DirectML ready!"
  echo ""
  echo "Run server with:  just src::dev-dml"
  echo "==========================================="

# Setup PyTorch with DirectML - Windows only (LEGACY - slower than ONNX)
# Creates .venv-dml with Python 3.11 for DirectML compatibility
setup-amd-directml:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  if [[ "{{os}}" != "windows" ]]; then
    echo "DirectML is Windows-only. On Linux, use: just src::setup-amd-rocm-linux"
    exit 1
  fi

  VENV_DIR=".venv-dml"

  echo "Setting up DirectML environment with Python 3.11..."
  echo "Target: $VENV_DIR"
  echo ""
  echo "Note: DirectML requires Python 3.8-3.11 on Windows"
  echo ""

  # Check if venv already exists
  if [ -d "$VENV_DIR" ]; then
    echo "Venv already exists at $VENV_DIR"
    echo "Activating and installing dependencies..."
  else
    # Try to find Python 3.11
    PY311=""
    if command -v pyenv &> /dev/null; then
      # Check if 3.11 is installed via pyenv
      if pyenv versions 2>/dev/null | grep -q "3.11"; then
        echo "Found Python 3.11 via pyenv"
        PY311="$(pyenv root)/versions/$(pyenv versions --bare | grep '^3\.11' | head -1)/python.exe"
      fi
    fi

    if [ -z "$PY311" ] && command -v py &> /dev/null && py -3.11 --version &> /dev/null 2>&1; then
      echo "Found Python 3.11 via py launcher"
      PY311="py -3.11"
    fi

    if [ -z "$PY311" ]; then
      echo "Python 3.11 not found. Installing via winget..."
      winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements || {
        echo ""
        echo "ERROR: Could not install Python 3.11"
        echo ""
        echo "Please install Python 3.11 manually from:"
        echo "  https://www.python.org/downloads/release/python-3119/"
        exit 1
      }
      PY311="py -3.11"
    fi

    echo "Creating venv with Python 3.11..."
    if [[ "$PY311" == "py -3.11" ]]; then
      py -3.11 -m venv "$VENV_DIR"
    else
      "$PY311" -m venv "$VENV_DIR"
    fi
  fi

  # Activate and install
  source "$VENV_DIR/{{venv_activate}}"

  echo ""
  echo "Installing PyTorch + DirectML..."
  python -m pip install --upgrade pip
  python -m pip install torch==2.4.1 torchvision==0.19.1 torch-directml transformers pillow numpy

  echo ""
  echo "Verifying installation..."
  python -c "import torch; import torch_directml; print(f'PyTorch: {torch.__version__}'); print(f'DirectML device: {torch_directml.device_name(0)}')"

  echo ""
  echo "=========================================="
  echo "DirectML environment ready!"
  echo ""
  echo "Run server with:  just src::dev-dml"
  echo "=========================================="

# Run dev server with DirectML venv (Windows only)
dev-dml:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  if [[ "{{os}}" != "windows" ]]; then
    echo "DirectML is Windows-only. On Linux, use: just src::dev"
    exit 1
  fi

  # Load .env.local if exists
  if [ -f ".env.local" ]; then
    set -a
    source .env.local
    set +a
    echo "Loaded .env.local"
  fi

  VENV_DIR=".venv-dml"

  if [ ! -d "$VENV_DIR" ]; then
    echo "DirectML venv not found. Run: just src::setup-amd-directml"
    exit 1
  fi

  source "$VENV_DIR/{{venv_activate}}"

  # Get absolute path to venv Python for PyO3
  VENV_PYTHON="$(cd "$VENV_DIR/Scripts" && pwd -W)/python.exe"
  export PYO3_PYTHON="$VENV_PYTHON"

  # Find the base Python 3.11 installation (where DLLs live)
  BASE_PYTHON_DIR=$(python -c "import sys; print(sys.base_prefix)")

  # Get the venv's site-packages path (sysconfig is more reliable than site on Windows)
  SITE_PACKAGES=$(python -c "import sysconfig; print(sysconfig.get_path('purelib'))")
  SITE_PACKAGES_WIN=$(cygpath -w "$SITE_PACKAGES" 2>/dev/null || echo "$SITE_PACKAGES")

  # Add base Python to PATH so Rust can find python311.dll at runtime
  export PATH="$BASE_PYTHON_DIR:$PATH"

  # Set PYTHONPATH so PyO3 finds the venv's packages
  PYTHON_DIR="{{ROOT}}/python"
  export PYTHONPATH="$SITE_PACKAGES;$PYTHON_DIR"

  # Explicit site-packages path for Rust
  export DEPTH_SITE_PACKAGES="$SITE_PACKAGES_WIN"

  # Skip Rust's auto-install since venv already has deps
  export DEPTH_SKIP_AUTO_INSTALL=1

  echo "Using DirectML venv"
  echo "  Python: $(python --version 2>&1)"
  echo "  PYO3_PYTHON: $PYO3_PYTHON"
  echo "  PYTHONPATH: $PYTHONPATH"
  echo ""

  # Clean and rebuild with correct Python (only once)
  if cargo build --bin server 2>&1 | grep -q "python3\.13"; then
    echo "Rebuilding Rust with Python 3.11..."
    cargo clean -p depth_browser
  fi

  # Run dev inline to preserve environment
  trap 'kill 0' SIGINT

  echo "Building WASM (dev)..."
  wasm-pack build wasm --target web --out-dir ../public/wasm --dev

  echo "Starting Next.js dev server on port 3031..."
  PORT=3031 HOSTNAME=127.0.0.1 bun next dev 2>&1 | sed 's/^/[WEB] /' &
  sleep 2

  echo "Starting Rust server on port 3030..."
  SERVER_PORT=3030 SERVER_PROXY_URL=http://127.0.0.1:3031 cargo run --bin server 2>&1 | sed 's/^/[RUST] /' &

  echo ""
  echo "==================================="
  echo "Running at: http://localhost:3030"
  echo "==================================="
  echo ""

  wait

# Run just the Rust server with DirectML (for debugging)
api-dml:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  if [[ "{{os}}" != "windows" ]]; then
    echo "DirectML is Windows-only."
    exit 1
  fi

  VENV_DIR=".venv-dml"
  source "$VENV_DIR/{{venv_activate}}"

  # Setup environment
  VENV_PYTHON="$(cd "$VENV_DIR/Scripts" && pwd -W)/python.exe"
  BASE_PYTHON_DIR=$(python -c "import sys; print(sys.base_prefix)")
  SITE_PACKAGES=$(python -c "import sysconfig; print(sysconfig.get_path('purelib'))")

  export PYO3_PYTHON="$VENV_PYTHON"
  export PATH="$BASE_PYTHON_DIR:$PATH"
  export PYTHONPATH="$SITE_PACKAGES;{{ROOT}}/python"
  export DEPTH_SITE_PACKAGES="$SITE_PACKAGES"
  export DEPTH_SKIP_AUTO_INSTALL=1

  echo "Environment:"
  echo "  PYO3_PYTHON=$PYO3_PYTHON"
  echo "  PYTHONPATH=$PYTHONPATH"
  echo "  DEPTH_SITE_PACKAGES=$DEPTH_SITE_PACKAGES"
  echo ""

  cargo run --bin server

# Run dev server with ONNX venv (Linux/cross-platform)
dev-onnx:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  VENV_DIR=".venv-onnx"

  # Load .env.local if exists
  if [ -f ".env.local" ]; then
    set -a
    source .env.local
    set +a
    echo "Loaded .env.local"
  fi

  if [ ! -d "$VENV_DIR" ]; then
    echo "ONNX venv not found. Run: just src::setup-onnx-cuda"
    exit 1
  fi

  source "$VENV_DIR/{{venv_activate}}"

  # Get venv Python path for PyO3
  if [[ "{{os}}" == "windows" ]]; then
    VENV_PYTHON="$(cd "$VENV_DIR/Scripts" && pwd -W)/python.exe"
    BASE_PYTHON_DIR=$(python -c "import sys; print(sys.base_prefix)")
    export PATH="$BASE_PYTHON_DIR:$PATH"
  else
    VENV_PYTHON="$(realpath "$VENV_DIR/bin/python")"
  fi
  export PYO3_PYTHON="$VENV_PYTHON"

  # Get site-packages path
  SITE_PACKAGES=$(python -c "import sysconfig; print(sysconfig.get_path('purelib'))")
  PYTHON_DIR="{{ROOT}}/python"

  if [[ "{{os}}" == "windows" ]]; then
    export PYTHONPATH="$SITE_PACKAGES;$PYTHON_DIR"
  else
    export PYTHONPATH="$SITE_PACKAGES:$PYTHON_DIR"
  fi

  export DEPTH_SITE_PACKAGES="$SITE_PACKAGES"
  export DEPTH_SKIP_AUTO_INSTALL=1

  echo "Using ONNX venv"
  echo "  Python: $(python --version 2>&1)"
  echo "  PYO3_PYTHON: $PYO3_PYTHON"
  echo "  PYTHONPATH: $PYTHONPATH"
  echo ""

  # Run dev inline to preserve environment
  trap 'kill 0' SIGINT

  echo "Building WASM (dev)..."
  wasm-pack build wasm --target web --out-dir ../public/wasm --dev

  echo "Starting Next.js dev server on port 3031..."
  PORT=3031 HOSTNAME=127.0.0.1 bun next dev 2>&1 | sed 's/^/[WEB] /' &
  sleep 2

  echo "Starting Rust server on port 3030..."
  SERVER_PORT=3030 SERVER_PROXY_URL=http://127.0.0.1:3031 cargo run --bin server 2>&1 | sed 's/^/[RUST] /' &

  echo ""
  echo "==================================="
  echo "Running at: http://localhost:3030"
  echo "==================================="
  echo ""

  wait

# Setup ZLUDA for AMD GPUs (experimental, broader GPU support)
setup-amd-zluda:
  #!/usr/bin/env bash
  set -euo pipefail

  echo "ZLUDA Setup for AMD GPUs"
  echo "========================"
  echo ""
  echo "ZLUDA PyTorch support is experimental and requires manual setup:"
  echo ""
  echo "1. Install AMD HIP SDK 6.2+ from:"
  echo "   https://www.amd.com/en/developer/resources/rocm-hub/hip-sdk.html"
  echo ""
  echo "2. Download ZLUDA prerelease from:"
  echo "   https://github.com/vosen/ZLUDA/releases"
  echo ""
  echo "3. Extract and add ZLUDA to PATH"
  echo ""
  echo "4. Install CUDA PyTorch (ZLUDA intercepts CUDA calls):"
  echo "   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124"
  echo ""
  echo "5. Run with ZLUDA:"
  echo "   zluda -- cargo run --bin server"
  echo ""
  echo "For more info: https://vosen.github.io/ZLUDA/"
  echo ""
  echo "Note: First run compiles kernels for your GPU (slow), subsequent runs are faster."

# === Model Management ===

# Download all models for offline use
download-models:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  echo "Downloading models for offline use..."

  # Use venv if available
  if [ -d ".venv-dml" ]; then
    source .venv-dml/{{venv_activate}}
  fi

  python python/download_models.py

# Check if models are cached locally
check-models:
  #!/usr/bin/env bash
  set -euo pipefail
  cd "{{ROOT}}"

  echo "Checking cached models..."
  echo ""

  if [ -d "models/huggingface" ]; then
    echo "[SERVER] HuggingFace cache: OK"
    du -sh models/huggingface 2>/dev/null || true
  else
    echo "[SERVER] HuggingFace cache: NOT FOUND"
    echo "  Run: just src::download-models"
  fi

  echo ""

  if [ -d "models/onnx/depth-anything-v2-small" ]; then
    echo "[CLIENT] ONNX models: OK"
    du -sh models/onnx 2>/dev/null || true
  else
    echo "[CLIENT] ONNX models: NOT FOUND"
    echo "  Run: just src::download-models"
  fi

# === Convenience aliases ===

# Auto-detect best GPU setup for current platform
setup-gpu:
  #!/usr/bin/env bash
  set -euo pipefail

  echo "Detecting GPU and platform..."
  echo ""

  if [[ "{{os}}" == "windows" ]]; then
    echo "Platform: Windows"
    echo ""
    echo "Available GPU setup options:"
    echo "  just src::setup-nvidia-cuda     - NVIDIA GPUs with CUDA"
    echo "  just src::setup-amd-directml    - Any DirectX 12 GPU (AMD/Intel/NVIDIA)"
    echo "  just src::setup-amd-rocm-windows - AMD RX 7000/9000 (ROCm native)"
    echo "  just src::setup-amd-zluda       - AMD GPUs via ZLUDA (experimental)"
    echo ""
    echo "Recommended for AMD: just src::setup-amd-directml"
  else
    echo "Platform: Linux"
    echo ""
    echo "Available GPU setup options:"
    echo "  just src::setup-nvidia-cuda     - NVIDIA GPUs with CUDA"
    echo "  just src::setup-amd-rocm-linux  - AMD GPUs with ROCm"
    echo ""
    echo "Check your GPU:"
    echo "  NVIDIA: nvidia-smi"
    echo "  AMD: rocminfo"
  fi
