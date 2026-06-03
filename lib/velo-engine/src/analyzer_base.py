"""
Abstract base class for all video analysis backends.

Any backend — MediaPipe, a custom trained model, or a third-party service —
must subclass VideoAnalyzer and implement `analyze_file`. The engine's HTTP
handler calls only this interface, so swapping backends is a one-line config
change.
"""

from abc import ABC, abstractmethod
from .models import TennisTelemetry


class VideoAnalyzer(ABC):
    """
    Common interface every pose-analysis backend must satisfy.

    Subclasses implement `analyze_file`, which receives a local path to a
    downloaded video and returns structured TennisTelemetry.  The engine
    handles downloading, temp-file cleanup, and thread-pool offloading before
    and after calling this method, so implementations only need to focus on
    analysis logic.
    """

    @abstractmethod
    def analyze_file(
        self,
        video_path: str,
        video_url: str,
        sample_rate: int = 3,
        max_duration_s: float = 45.0,
    ) -> TennisTelemetry:
        """
        Analyze a tennis video and return structured biomechanical telemetry.

        Parameters
        ----------
        video_path      : Absolute path to a temporary local copy of the video.
        video_url       : Original URL the video was fetched from (stored in
                          the returned telemetry for traceability).
        sample_rate     : Analyze every Nth frame.  Higher values are faster
                          but reduce temporal resolution.
        max_duration_s  : Discard video content beyond this many seconds.

        Returns
        -------
        TennisTelemetry : Pydantic model with joint angles, stroke phases,
                          symmetry score, dominant stroke, and stroke count.

        Raises
        ------
        ValueError      : If the video contains no detectable pose landmarks.
        """
        ...
