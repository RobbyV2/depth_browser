"""Check available GPU backends for PyTorch."""

import sys

def main():
    try:
        import torch
    except ImportError:
        print("PyTorch not installed")
        print("Run: just src::setup-python")
        sys.exit(1)

    print(f"PyTorch: {torch.__version__}")
    print(f"Python: {sys.version.split()[0]}")
    print()

    # Check CUDA (includes ROCm which presents as CUDA)
    print(f"CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"  CUDA version: {torch.version.cuda}")
        print(f"  Device count: {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            print(f"  Device {i}: {torch.cuda.get_device_name(i)}")

    # Check ROCm (shows as CUDA on ROCm builds, but has HIP version)
    if hasattr(torch.version, "hip") and torch.version.hip:
        print(f"ROCm/HIP version: {torch.version.hip}")

    # Check MPS (Apple Silicon)
    if hasattr(torch.backends, "mps"):
        mps_available = torch.backends.mps.is_available()
        print(f"MPS available: {mps_available}")
        if mps_available:
            print("  Device: Apple Silicon GPU")

    # Check DirectML (Windows)
    try:
        import torch_directml
        print(f"DirectML available: True")
        device_count = torch_directml.device_count()
        print(f"  Device count: {device_count}")
        for i in range(device_count):
            print(f"  Device {i}: {torch_directml.device_name(i)}")
    except ImportError:
        print("DirectML available: False")
    except Exception as e:
        print(f"DirectML error: {e}")

    # Summary
    print()
    if torch.cuda.is_available():
        if hasattr(torch.version, "hip") and torch.version.hip:
            print("Best backend: ROCm (via CUDA API)")
        else:
            print("Best backend: CUDA")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        print("Best backend: MPS")
    else:
        try:
            import torch_directml
            print("Best backend: DirectML")
        except ImportError:
            print("Best backend: CPU (no GPU acceleration)")
            print()
            print("To enable GPU acceleration:")
            print("  just src::setup-gpu")


if __name__ == "__main__":
    main()
