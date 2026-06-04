"""
Analyzer factory.

Selects the pose-analysis backend and returns a singleton VideoAnalyzer. The
engine's HTTP handler calls only the VideoAnalyzer interface, so this is the
single place the backend choice is made.

Backend env var (unified)
--------------------------
VISION_ENGINE (preferred), falling back to ANALYZER_BACKEND (legacy alias).

  yolo       YOLO11-pose, v2 nested telemetry (DEFAULT, going-forward).
  mediapipe  DEMOTED this cycle — emits legacy flat v1 telemetry, which the v2
             /analyze route can no longer serialize. Raises until ported to v2.
  custom     DEMOTED — stub (analyzer_custom.py) is unimplemented.
"""

import logging
import os

from .analyzer_base import VideoAnalyzer

log = logging.getLogger("factory")

# VISION_ENGINE is the going-forward name; ANALYZER_BACKEND kept as a read-fallback
# alias for one release so existing deploys don't break. Default: yolo.
_BACKEND = (
    os.environ.get("VISION_ENGINE")
    or os.environ.get("ANALYZER_BACKEND")
    or "yolo"
).lower().strip()
_instance: VideoAnalyzer | None = None

_DEMOTED = {
    "mediapipe": (
        "MediaPipe backend is demoted this cycle: it emits legacy flat v1 telemetry, "
        "which the v2 /analyze route cannot serialize. Use VISION_ENGINE=yolo, or port "
        "MediaPipeAnalyzer to emit v2 TennisTelemetry first."
    ),
    "custom": (
        "Custom backend (analyzer_custom.py) is an unimplemented stub. Use VISION_ENGINE=yolo."
    ),
}


def get_analyzer() -> VideoAnalyzer:
    """Return the process-wide singleton analyzer (lazily built on first call)."""
    global _instance
    if _instance is None:
        _instance = _build()
    return _instance


def _build() -> VideoAnalyzer:
    if _BACKEND == "yolo":
        log.info("Analyzer backend: YOLO11-pose (v2)")
        from .analyzer_yolo import YoloAnalyzer
        return YoloAnalyzer()

    if _BACKEND in _DEMOTED:
        raise NotImplementedError(_DEMOTED[_BACKEND])

    raise ValueError(
        f"Unknown VISION_ENGINE/ANALYZER_BACKEND='{_BACKEND}'. Supported: yolo "
        "(mediapipe and custom are demoted this cycle)."
    )
