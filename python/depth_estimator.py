"""
Depth Anything V2 estimator for server-side inference.
Supports: CUDA, ROCm, DirectML, and CPU backends.
This module is loaded by PyO3 and called from Rust.
"""

import sys
import io
import numpy as np
from PIL import Image

# Lazy load model components
_model = None
_image_processor = None
_device = None
_backend = None
_torch_dtype = None


def _detect_best_device():
    """Detect the best available compute device."""
    import torch

    # Check CUDA (includes ROCm which presents as CUDA)
    if torch.cuda.is_available():
        device_name = torch.cuda.get_device_name(0)
        # ROCm builds have HIP version
        if hasattr(torch.version, "hip") and torch.version.hip:
            return "cuda", f"ROCm/HIP ({device_name})"
        return "cuda", f"CUDA ({device_name})"

    # Check MPS (Apple Silicon)
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps", "MPS (Apple Silicon)"

    # Check DirectML
    try:
        import torch_directml

        dml_device = torch_directml.device()
        device_name = torch_directml.device_name(0)
        return dml_device, f"DirectML ({device_name})"
    except ImportError:
        pass

    return "cpu", "CPU"


def _get_cache_dir():
    """Get local cache directory for models."""
    import os
    # Use models/ in project root, or fall back to HF default
    script_dir = os.path.dirname(os.path.abspath(__file__))
    cache_dir = os.path.join(script_dir, "..", "models", "huggingface")
    return os.path.abspath(cache_dir)


def _ensure_model():
    """Lazy load the model on first use."""
    global _model, _image_processor, _device, _backend, _torch_dtype

    if _model is not None:
        return

    import os
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    _device, _backend = _detect_best_device()
    print(f"[DEPTH] Using device: {_backend}", flush=True)

    # Determine dtype based on device
    is_directml = isinstance(_device, torch.device) or (
        hasattr(_device, "type") and "privateuseone" in str(_device).lower()
    )

    if is_directml:
        _torch_dtype = torch.float32
    elif _device in ("cuda", "mps"):
        _torch_dtype = torch.float16
    else:
        _torch_dtype = torch.float32

    model_id = "depth-anything/Depth-Anything-V2-Small-hf"
    cache_dir = _get_cache_dir()
    os.makedirs(cache_dir, exist_ok=True)

    # Try offline first (cached), fall back to download
    try:
        print(f"[DEPTH] Loading from cache: {cache_dir}", flush=True)
        _image_processor = AutoImageProcessor.from_pretrained(
            model_id, use_fast=True, cache_dir=cache_dir, local_files_only=True
        )
        _model = AutoModelForDepthEstimation.from_pretrained(
            model_id, torch_dtype=_torch_dtype, cache_dir=cache_dir, local_files_only=True
        )
        print("[DEPTH] Loaded from local cache", flush=True)
    except Exception:
        print("[DEPTH] Cache miss, downloading model...", flush=True)
        _image_processor = AutoImageProcessor.from_pretrained(
            model_id, use_fast=True, cache_dir=cache_dir
        )
        _model = AutoModelForDepthEstimation.from_pretrained(
            model_id, torch_dtype=_torch_dtype, cache_dir=cache_dir
        )
        print("[DEPTH] Model downloaded and cached", flush=True)

    # Move to device
    if _device != "cpu":
        _model = _model.to(_device)
        print(f"[DEPTH] Model moved to {_device}", flush=True)

    # Compile for CUDA only (not DirectML/MPS)
    if hasattr(torch, "compile") and _device == "cuda":
        try:
            _model = torch.compile(_model, mode="reduce-overhead")
            print("[DEPTH] Model compiled with torch.compile", flush=True)
        except Exception as e:
            print(f"[DEPTH] torch.compile skipped: {e}", flush=True)

    _model.eval()
    print("[DEPTH] Model loaded successfully", flush=True)


class DepthEstimator:
    """Depth estimation wrapper called from Rust via PyO3."""

    def __init__(self):
        _ensure_model()

    def estimate(self, jpeg_bytes: bytes) -> bytes:
        """
        Run depth estimation on JPEG bytes.

        Args:
            jpeg_bytes: JPEG encoded image

        Returns:
            Grayscale depth map as raw bytes (uint8, H x W)
        """
        import time
        import torch

        t0 = time.perf_counter()

        image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        orig_size = image.size
        t1 = time.perf_counter()

        # Preprocess
        inputs = _image_processor(images=image, return_tensors="pt")
        t2 = time.perf_counter()

        # Move inputs to device
        if _device != "cpu":
            inputs = {k: v.to(_device) for k, v in inputs.items()}
        if _torch_dtype == torch.float16:
            inputs = {k: v.half() if v.dtype == torch.float32 else v for k, v in inputs.items()}
        t3 = time.perf_counter()

        # Inference
        with torch.no_grad():
            outputs = _model(**inputs)
            predicted_depth = outputs.predicted_depth.squeeze()
        t4 = time.perf_counter()

        # Skip interpolation - client will upscale via WebGL (much faster)
        t5 = time.perf_counter()

        # Normalize to 0-255
        depth = predicted_depth.cpu().numpy()
        t6 = time.perf_counter()

        depth_min, depth_max = depth.min(), depth.max()
        if depth_max - depth_min > 0:
            depth = (depth - depth_min) / (depth_max - depth_min) * 255
        depth = depth.astype(np.uint8)
        t7 = time.perf_counter()

        # Log timing every ~100 frames
        if hasattr(self, '_frame_count'):
            self._frame_count += 1
        else:
            self._frame_count = 1

        if self._frame_count % 100 == 1:
            h, w = depth.shape
            print(f"[DEPTH] Timing: decode={1000*(t1-t0):.1f}ms preproc={1000*(t2-t1):.1f}ms "
                  f"to_device={1000*(t3-t2):.1f}ms infer={1000*(t4-t3):.1f}ms "
                  f"interp={1000*(t5-t4):.1f}ms cpu={1000*(t6-t5):.1f}ms norm={1000*(t7-t6):.1f}ms "
                  f"total={1000*(t7-t0):.1f}ms size={w}x{h}", flush=True)

        # Prepend dimensions (width, height as 2-byte big-endian)
        h, w = depth.shape
        header = w.to_bytes(2, 'big') + h.to_bytes(2, 'big')
        return header + depth.tobytes()
