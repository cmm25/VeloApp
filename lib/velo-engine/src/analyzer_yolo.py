"""
YOLO11-pose backend (the going-forward Tier-1 engine).

Thin wrapper that satisfies the VideoAnalyzer interface. It owns Pass-0 (CFR
normalization — the determinism anchor + VFR timestamp fix) and its cleanup,
then delegates the actual analysis to yolo_analyze.analyze_video_file. Keeping
Pass-0 here (not in analyze_video_file) means cleanup is handled by one
try/finally that covers every exit path, including the no-pose ValueError.
"""

import logging
import os
from typing import Optional

from .analyzer_base import VideoAnalyzer
from .models import AnalyzeRequest, TennisTelemetry
from .video_io import ensure_cfr, frame_stream_sha256
from .yolo_analyze import analyze_video_file, get_model

log = logging.getLogger("analyzer.yolo")

# Canonical/on-chain mode: also compute the (expensive) decoded-frame-stream hash as the
# determinism anchor. Off by default so normal /analyze stays fast.
CANONICAL = os.getenv("DET_CANONICAL", "0").lower() not in ("0", "false", "no")


class YoloAnalyzer(VideoAnalyzer):
    def __init__(self) -> None:
        # Eager-load the pose model at construction (Craig's fail-fast warmup contract).
        get_model()

    def analyze_file(
        self,
        video_path: str,
        video_url: str,
        sample_rate: int = 5,
        max_duration_s: float = 45.0,
        request: Optional[AnalyzeRequest] = None,
    ) -> TennisTelemetry:
        cfr_path, normalized, cfr_fps = ensure_cfr(video_path)
        try:
            frame_sha = frame_stream_sha256(cfr_path) if CANONICAL else None
            kwargs = {}
            if request is not None:
                kwargs = dict(
                    video_cid=request.video_cid,
                    subject=request.subject,
                    emit_keyframes=request.emit_keyframes,
                    keyframe_format=request.keyframe_format,
                    emit_raw_keypoints=request.emit_raw_keypoints,
                )
            log.info(f"YOLO backend: analyzing {cfr_path} (cfr={normalized}, fps={cfr_fps})")
            return analyze_video_file(
                cfr_path,
                video_url,
                sample_rate=sample_rate,
                max_duration_s=max_duration_s,
                normalized_cfr=normalized,
                cfr_fps=cfr_fps,
                frame_stream_sha256=frame_sha,
                **kwargs,
            )
        finally:
            if normalized and cfr_path != video_path and os.path.exists(cfr_path):
                try:
                    os.unlink(cfr_path)
                except OSError:
                    pass
