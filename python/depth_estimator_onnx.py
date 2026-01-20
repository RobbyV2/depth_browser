"""
Depth Anything V2 estimator using ONNX Runtime with DirectML.
Much faster than PyTorch+DirectML for inference.
"""

import io
import os
import time
import numpy as np
from PIL import Image
from pathlib import Path

_session = None
_backend = None
_input_name = None

# Try TurboJPEG for faster decoding (optional)
try:
    from turbojpeg import TurboJPEG
    _tjpeg = TurboJPEG()
    _use_turbojpeg = True
except ImportError:
    _tjpeg = None
    _use_turbojpeg = False

SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR.parent
ONNX_MODEL_DIR = PROJECT_ROOT / "models" / "onnx" / "depth-anything-v2-small" / "onnx"

# ImageNet normalization (inlined for speed)
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def _get_onnx_model_path():
    """Find the ONNX model file."""
    priority = ["model_fp16.onnx", "model.onnx"]
    for name in priority:
        path = ONNX_MODEL_DIR / name
        if path.exists():
            return str(path)
    return None


def _detect_best_provider():
    """Detect best ONNX Runtime execution provider."""
    import onnxruntime as ort
    providers = ort.get_available_providers()

    if "DmlExecutionProvider" in providers:
        return ["DmlExecutionProvider", "CPUExecutionProvider"], "DirectML"
    if "CUDAExecutionProvider" in providers:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"], "CUDA"
    return ["CPUExecutionProvider"], "CPU"


def _ensure_session():
    """Initialize ONNX Runtime session with warmup."""
    global _session, _backend, _input_name

    if _session is not None:
        return

    import onnxruntime as ort

    model_path = _get_onnx_model_path()
    if not model_path:
        raise RuntimeError(f"ONNX model not found in {ONNX_MODEL_DIR}\nRun: just src::download-models")

    providers, _backend = _detect_best_provider()
    print(f"[DEPTH-ONNX] Using: {_backend}", flush=True)
    print(f"[DEPTH-ONNX] Model: {model_path}", flush=True)
    if _use_turbojpeg:
        print("[DEPTH-ONNX] TurboJPEG: enabled", flush=True)

    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    # DirectML requires sequential execution and no memory pattern
    if _backend == "DirectML":
        sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        sess_options.enable_mem_pattern = False

    _session = ort.InferenceSession(model_path, sess_options=sess_options, providers=providers)
    _input_name = _session.get_inputs()[0].name

    print(f"[DEPTH-ONNX] Input: {_input_name} {_session.get_inputs()[0].shape}", flush=True)

    # Warmup: run 3 dummy inferences to initialize GPU
    max_size = int(os.environ.get("NEXT_PUBLIC_DEPTH_INFERENCE_BASE", "280"))
    dummy_h = (max_size // 14) * 14
    dummy_w = dummy_h
    dummy = np.random.randn(1, 3, dummy_h, dummy_w).astype(np.float32)
    print("[DEPTH-ONNX] Warming up...", flush=True)
    for _ in range(3):
        _session.run(None, {_input_name: dummy})
    print("[DEPTH-ONNX] Session ready", flush=True)


def _decode_jpeg(jpeg_bytes: bytes) -> Image.Image:
    """Decode JPEG bytes to PIL Image."""
    if _use_turbojpeg:
        # TurboJPEG returns BGR numpy array
        bgr = _tjpeg.decode(jpeg_bytes)
        rgb = bgr[:, :, ::-1]  # BGR -> RGB
        return Image.fromarray(rgb)
    return Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")


def _preprocess(image: Image.Image, max_size: int) -> tuple[np.ndarray, tuple[int, int]]:
    """Preprocess image, preserving aspect ratio. Output dims are multiples of 14."""
    w, h = image.size
    scale = max_size / max(w, h)
    new_w = max((int(w * scale) // 14) * 14, 14)
    new_h = max((int(h * scale) // 14) * 14, 14)

    image = image.resize((new_w, new_h), Image.Resampling.BILINEAR)

    # Normalize with ImageNet stats (using module-level constants)
    img = np.array(image, dtype=np.float32) / 255.0
    img = (img - _MEAN) / _STD

    # HWC -> NCHW
    img = img.transpose(2, 0, 1)[None].astype(np.float32)
    return img, (new_h, new_w)


class DepthEstimatorONNX:
    """ONNX Runtime depth estimator."""

    def __init__(self):
        _ensure_session()
        self._frame_count = 0

    def estimate(self, jpeg_bytes: bytes) -> bytes:
        """Run depth estimation on JPEG bytes."""
        t0 = time.perf_counter()

        image = _decode_jpeg(jpeg_bytes)
        t1 = time.perf_counter()

        max_size = int(os.environ.get("NEXT_PUBLIC_DEPTH_INFERENCE_BASE", "280"))
        input_tensor, _ = _preprocess(image, max_size=max_size)
        t2 = time.perf_counter()

        outputs = _session.run(None, {_input_name: input_tensor})
        depth = outputs[0].squeeze()
        t3 = time.perf_counter()

        # Normalize to 0-255
        depth_min, depth_max = depth.min(), depth.max()
        if depth_max - depth_min > 0:
            depth = (depth - depth_min) / (depth_max - depth_min) * 255
        depth = depth.astype(np.uint8)
        t4 = time.perf_counter()

        self._frame_count += 1
        if self._frame_count % 100 == 1:
            h, w = depth.shape
            print(f"[DEPTH-ONNX] decode={1000*(t1-t0):.1f}ms preproc={1000*(t2-t1):.1f}ms "
                  f"infer={1000*(t3-t2):.1f}ms norm={1000*(t4-t3):.1f}ms "
                  f"total={1000*(t4-t0):.1f}ms size={w}x{h}", flush=True)

        # Return with header (width, height as 2-byte big-endian)
        h, w = depth.shape
        header = w.to_bytes(2, 'big') + h.to_bytes(2, 'big')
        return header + depth.tobytes()


# Alias for compatibility
DepthEstimator = DepthEstimatorONNX
