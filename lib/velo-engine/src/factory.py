"""
Analyzer factory.

Reads ANALYZER_BACKEND from the environment (default: mediapipe) and returns
the corresponding VideoAnalyzer instance.  The engine's HTTP handler calls
only the VideoAnalyzer interface, so this is the single place where the
backend choice is made.

Supported values for ANALYZER_BACKEND
--------------------------------------
mediapipe   Use Google MediaPipe Pose (default, no extra setup needed).
custom      Use the custom trained model in analyzer_custom.py.
            Requires CUSTOM_MODEL_PATH to point to your weights file.
"""

import logging
import os

from .analyzer_base import VideoAnalyzer

log = logging.getLogger("factory")

_BACKEND = os.environ.get("ANALYZER_BACKEND", "mediapipe").lower().strip()
_instance: VideoAnalyzer | None = None


def get_analyzer() -> VideoAnalyzer:
    """
    Return the singleton analyzer for this process.
    Instantiated lazily on first call so startup is fast.
    """
    global _instance
    if _instance is None:
        _instance = _build()
    return _instance


def _build() -> VideoAnalyzer:
    if _BACKEND == "custom":
        log.info("Analyzer backend: custom model")
        from .analyzer_custom import CustomModelAnalyzer
        return CustomModelAnalyzer()

    if _BACKEND == "mediapipe":
        log.info("Analyzer backend: MediaPipe")
        from .analyzer_mediapipe import MediaPipeAnalyzer
        return MediaPipeAnalyzer()

    raise ValueError(
        f"Unknown ANALYZER_BACKEND='{_BACKEND}'. "
        "Supported values: mediapipe, custom"
    )
