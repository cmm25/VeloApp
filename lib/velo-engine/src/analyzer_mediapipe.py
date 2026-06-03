"""
MediaPipe Pose backend for velo-engine.

This is the default analyzer.  It uses Google's MediaPipe Pose Landmarker
(33-point body model) to extract joint angles frame-by-frame, then runs the
stroke phase classifier, symmetry scorer, and dominant stroke detector from
analyze.py on the resulting angle sequence.

To switch to a different backend, set ANALYZER_BACKEND=custom in the
environment and drop your weights into custom_models/ — this file is not
touched.
"""

import logging

from .analyzer_base import VideoAnalyzer
from .analyze import analyze_video_file
from .models import TennisTelemetry

log = logging.getLogger("analyzer.mediapipe")


class MediaPipeAnalyzer(VideoAnalyzer):
    """
    Wraps the existing analyze_video_file function so it satisfies the
    VideoAnalyzer interface.  All MediaPipe-specific logic lives in
    analyze.py; this class is intentionally thin.
    """

    def analyze_file(
        self,
        video_path: str,
        video_url: str,
        sample_rate: int = 3,
        max_duration_s: float = 45.0,
    ) -> TennisTelemetry:
        log.info(f"MediaPipe backend: analyzing {video_path}")
        return analyze_video_file(
            video_path=video_path,
            video_url=video_url,
            sample_rate=sample_rate,
            max_duration_s=max_duration_s,
        )
