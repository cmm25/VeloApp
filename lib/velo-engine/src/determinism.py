"""
Determinism layer for on-chain-auditable telemetry.

IMPORT THIS MODULE FIRST (before numpy/torch/cv2/ultralytics) so the thread-count
env vars are set before those libraries build their thread pools — a pool created
at numpy import can't be un-threaded later in code.

Measured fact (2026-06-05, yolo11s-pose, torch 2.5.1 CPU): keypoint inference is
already bit-identical run-to-run on the same machine, even across thread counts
(0.000000px drift). So *same-arch* reproducibility is essentially free; pinning turns
it into a guarantee, and the canonical hash is the commitment. Keypoint/float rounding
+ explicit tie-breaks are the cross-architecture insurance layer (cannot be measured
locally). HONEST SCOPE: the hash is reproducible on the SAME pinned arch + image, not
across arbitrary hardware (see docs/VELO-NN-MASTER-LOG.md §3 + residual table).
"""

import os

# Set BEFORE numpy/torch/cv2 import anywhere in the process (load-bearing import order).
for _k, _v in {
    "OMP_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "VECLIB_MAXIMUM_THREADS": "1",
    "PYTHONHASHSEED": "0",
    "CUBLAS_WORKSPACE_CONFIG": ":4096:8",
}.items():
    os.environ.setdefault(_k, _v)

import hashlib
import json
import math
from typing import Any, Optional

SEED = 0
HASH_FLOAT_DECIMALS = 6  # all floats are computed to 6dp; canonical form formats to %.6f
KEYPOINT_GRID_PX = 0.01  # round keypoints before geometry (cross-arch buffer; same-arch drift=0)

_PINNED = False


def pin_determinism(seed: int = SEED) -> dict:
    """Force deterministic single-thread execution + seed every RNG. Idempotent.
    Call once at process start, before model load. Returns the pinned config."""
    global _PINNED
    if _PINNED:
        return {"seed": seed, "threads": 1, "torch_deterministic": True}
    import random
    random.seed(seed)
    cfg: dict[str, Any] = {"seed": seed, "threads": 1}
    try:
        import numpy as np
        np.random.seed(seed)
    except Exception:
        pass
    try:
        import cv2
        cv2.setNumThreads(0)   # 0 = single-threaded in OpenCV's API
        cv2.setRNGSeed(seed)
    except Exception:
        pass
    try:
        import torch
        torch.manual_seed(seed)
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        torch.use_deterministic_algorithms(True, warn_only=True)
        cfg["torch_deterministic"] = True
    except Exception as e:
        cfg["torch_deterministic"] = f"unavailable: {e}"
    _PINNED = True
    return cfg


def lib_versions() -> dict:
    out = {}
    for name in ("torch", "ultralytics", "numpy", "scipy", "cv2"):
        try:
            out[name] = getattr(__import__(name), "__version__", "?")
        except Exception:
            out[name] = "absent"
    return out


def weights_sha256(path: Optional[str]) -> Optional[str]:
    """SHA-256 of the weights file — pins WHICH model produced the telemetry."""
    if not path or not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ── Rounding helpers (apply at the boundary, not just at the end) ──

def r6(value):
    """Round a float to 6dp, normalizing -0.0 and dropping non-finite → None."""
    if value is None:
        return None
    v = float(value)
    if not math.isfinite(v):
        return None
    out = round(v, HASH_FLOAT_DECIMALS)
    return 0.0 if out == 0 else out


def round_keypoints(xy, grid: float = KEYPOINT_GRID_PX):
    """Quantize keypoints to a px grid BEFORE geometry so identical rounded inputs give
    bit-identical numpy geometry across architectures (absorbs conv/NMS/filtfilt ULP)."""
    import numpy as np
    return np.round(np.asarray(xy, dtype=float) / grid) * grid


# ── Canonical serialization + hash (the on-chain commitment surface) ──

def _canon(o: Any) -> Any:
    if isinstance(o, bool):
        return o
    if isinstance(o, float):
        v = r6(o)
        return None if v is None else float(f"{v:.6f}")
    if isinstance(o, dict):
        return {k: _canon(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_canon(v) for v in o]
    return o


def canonical_json(obj: Any) -> str:
    return json.dumps(_canon(obj), sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def telemetry_hash(payload: Any) -> str:
    """SHA-256 over the canonical JSON of the hashable subset — the on-chain commitment."""
    return "sha256:" + hashlib.sha256(canonical_json(payload).encode("ascii")).hexdigest()


def dead_band_argmax(values, band: float) -> int:
    """argmax with a dead-band tie-break: among entries within `band` of the max, return
    the LOWEST index. Robust to sub-band float wobble. NaNs ignored."""
    import numpy as np
    a = np.asarray(values, dtype=float)
    finite = np.isfinite(a)
    if not finite.any():
        return 0
    mx = float(np.nanmax(a))
    return int(np.argmax(finite & (a >= mx - band)))
