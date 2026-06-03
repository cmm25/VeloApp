"""
Custom model backend for velo-engine.

Use this file to wire in your own pose estimation model in place of MediaPipe.
The contract is identical to MediaPipeAnalyzer — implement `analyze_file` and
return a populated TennisTelemetry object.

How to activate
---------------
1.  Place your model weights inside `lib/velo-engine/custom_models/`
    (any format: ONNX, TFLite, PyTorch .pt, etc.).
2.  Set  ANALYZER_BACKEND=custom  in your environment or .env.
3.  Set  CUSTOM_MODEL_PATH=custom_models/your_weights_file  (relative to the
    container WORKDIR /app, which is the velo-engine root).
4.  Implement the three helper methods below:
      _load_model   — load weights once at init time
      _run_inference — given a BGR frame (numpy array), return 33 landmark
                       structs compatible with JointAngles extraction, OR
                       return a fully populated JointAngles directly
      analyze_file  — orchestrate download → inference loop → telemetry
5.  Rebuild and redeploy the engine container.

Output contract
---------------
Your model must produce the same five angles that MediaPipe produces:
  shoulder  — elbow-shoulder-hip (arm lift vs torso), degrees
  elbow     — wrist-elbow-shoulder (extension), degrees
  wrist     — index-wrist-elbow (cock/snap), degrees
  hip       — shoulder-hip-knee (trunk rotation proxy), degrees
  knee      — hip-knee-ankle (drive/bend), degrees

These five numbers are what the Form Agent reasons over.  As long as your
model produces them, everything downstream works unchanged.

Tip: you can reuse the pure-math helpers from analyze.py (angle_between,
compute_symmetry_score, detect_dominant_stroke, count_strokes,
classify_stroke_phase) — they are model-agnostic and work on any sequence of
JointAngles objects.
"""

import logging
import os

from .analyzer_base import VideoAnalyzer
from .models import TennisTelemetry, JointAngles, DominantStroke

log = logging.getLogger("analyzer.custom")

CUSTOM_MODEL_PATH = os.environ.get("CUSTOM_MODEL_PATH", "custom_models/model.onnx")


class CustomModelAnalyzer(VideoAnalyzer):
    """
    Stub implementation.  Replace the body of each method with your own logic.
    """

    def __init__(self) -> None:
        self.model = self._load_model()

    def _load_model(self):
        """
        Load model weights from CUSTOM_MODEL_PATH.
        Called once at startup.  Return whatever handle your inference
        framework uses (e.g. onnxruntime.InferenceSession, torch.nn.Module).
        Raise RuntimeError if the weights file is missing so the engine fails
        fast at boot rather than at the first request.
        """
        if not os.path.exists(CUSTOM_MODEL_PATH):
            raise RuntimeError(
                f"Custom model weights not found at '{CUSTOM_MODEL_PATH}'. "
                "Place your weights file there or set CUSTOM_MODEL_PATH."
            )
        log.info(f"Loading custom model from {CUSTOM_MODEL_PATH}")
        raise NotImplementedError(
            "CustomModelAnalyzer._load_model is not implemented yet. "
            "See the docstring in analyzer_custom.py for instructions."
        )

    def analyze_file(
        self,
        video_path: str,
        video_url: str,
        sample_rate: int = 3,
        max_duration_s: float = 45.0,
    ) -> TennisTelemetry:
        """
        Run your model frame-by-frame and return TennisTelemetry.

        A minimal implementation follows the same loop as analyze.py:
          1. Open the video with cv2.VideoCapture(video_path)
          2. For every Nth frame, run _run_inference(frame) → JointAngles
          3. Accumulate the angle list
          4. Call the shared helpers to compute peak/avg/symmetry/stroke type
          5. Return TennisTelemetry(is_mock=False, ...)

        The helpers you can reuse from analyze.py:
          compute_symmetry_score(angles_list)
          detect_dominant_stroke(angles_list)
          count_strokes(angles_list)
          classify_stroke_phase(angles_list, idx)
        """
        raise NotImplementedError(
            "CustomModelAnalyzer.analyze_file is not implemented yet. "
            "See the docstring in analyzer_custom.py for instructions."
        )
