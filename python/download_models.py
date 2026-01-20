#!/usr/bin/env python3
"""Download and cache all models for offline use."""

import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR.parent
MODELS_DIR = PROJECT_ROOT / "models"

# Server model (HuggingFace transformers format)
SERVER_MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"
SERVER_CACHE_DIR = MODELS_DIR / "huggingface"

# Client model (ONNX format for WebGPU)
CLIENT_MODEL_ID = "onnx-community/depth-anything-v2-small"
CLIENT_CACHE_DIR = MODELS_DIR / "onnx"


def download_server_model():
    """Download HuggingFace model for server-side inference (PyTorch path)."""
    print(f"\n[SERVER] Downloading {SERVER_MODEL_ID}...")
    print(f"[SERVER] Cache dir: {SERVER_CACHE_DIR}")

    try:
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation

        SERVER_CACHE_DIR.mkdir(parents=True, exist_ok=True)

        processor = AutoImageProcessor.from_pretrained(
            SERVER_MODEL_ID, cache_dir=SERVER_CACHE_DIR
        )
        model = AutoModelForDepthEstimation.from_pretrained(
            SERVER_MODEL_ID, cache_dir=SERVER_CACHE_DIR
        )

        print(f"[SERVER] Downloaded to {SERVER_CACHE_DIR}")
        return True
    except ImportError:
        print("[SERVER] Skipping PyTorch model (transformers not installed)")
        print("[SERVER] Using ONNX path instead (recommended)")
        return True


def download_client_model():
    """Download ONNX model for client-side WebGPU inference."""
    print(f"\n[CLIENT] Downloading {CLIENT_MODEL_ID}...")
    print(f"[CLIENT] Cache dir: {CLIENT_CACHE_DIR}")

    from huggingface_hub import snapshot_download

    CLIENT_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Download the entire ONNX model repo
    local_dir = CLIENT_CACHE_DIR / "depth-anything-v2-small"
    snapshot_download(
        repo_id=CLIENT_MODEL_ID,
        local_dir=local_dir,
        local_dir_use_symlinks=False,
    )

    print(f"[CLIENT] Downloaded to {local_dir}")

    # List downloaded files
    print("[CLIENT] Files:")
    for f in local_dir.rglob("*"):
        if f.is_file():
            size_mb = f.stat().st_size / (1024 * 1024)
            print(f"  {f.relative_to(local_dir)} ({size_mb:.1f} MB)")

    return True


def main():
    print("=" * 60)
    print("DepthXR Model Downloader")
    print("=" * 60)

    success = True

    try:
        download_server_model()
    except Exception as e:
        print(f"[SERVER] Error: {e}")
        success = False

    try:
        download_client_model()
    except Exception as e:
        print(f"[CLIENT] Error: {e}")
        success = False

    print("\n" + "=" * 60)
    if success:
        print("All models downloaded successfully!")
        print(f"Models cached in: {MODELS_DIR}")
    else:
        print("Some downloads failed. Check errors above.")
    print("=" * 60)

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
