"""
Abstract base class for all video analysis backends.

Any backend — YOLO11-pose (going-forward), MediaPipe (legacy), or a custom
trained model — subclasses VideoAnalyzer and implements `analyze_file`. The
engine's HTTP handler calls only this interface, so the backend is a one-line
config change (VISION_ENGINE / factory.py).
"""

from abc import ABC, abstractmethod
from typing import Optional

from .models import AnalyzeRequest, TennisTelemetry


class VideoAnalyzer(ABC):
    """
    Common interface every pose-analysis backend must satisfy.

    Subclasses implement `analyze_file`, which receives a local path to a
    downloaded video and returns a v2 `TennisTelemetry`. The engine handles
    download, temp-file cleanup, and thread-pool offload around this call.
    """

    @abstractmethod
    def analyze_file(
        self,
        video_path: str,
        video_url: str,
        sample_rate: int = 5,
        max_duration_s: float = 45.0,
        request: Optional[AnalyzeRequest] = None,
    ) -> TennisTelemetry:
        """
        Analyze a tennis video and return structured biomechanical telemetry.

        Parameters
        ----------
        video_path     : Absolute path to a temporary local copy of the video.
        video_url      : Original URL the video was fetched from (stored in telemetry).
        sample_rate    : Analyze every Nth frame (coarse pass).
        max_duration_s : Discard video content beyond this many seconds.
        request        : The full AnalyzeRequest, so richer backends (YOLO) can read
                         subject-selection / keyframe / raw-keypoint options without
                         widening the positional signature. Thin backends ignore it.

        Returns
        -------
        TennisTelemetry : v2 nested model (engine/video/subject/strokes/aggregate/…).

        Raises
        ------
        ValueError         : No detectable pose / subject.
        NotImplementedError: Backend is demoted/unsupported in this build.
        """
        ...
