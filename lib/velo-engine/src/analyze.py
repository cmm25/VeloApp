"""
Tennis pose analysis pipeline using Google MediaPipe Pose Landmarker.

Pipeline:
  1. Download video from URL (max 45s)
  2. Extract frames at configured sample rate
  3. Run MediaPipe Pose on each frame
  4. Compute joint angles for tennis kinetic chain
  5. Classify stroke phases (preparation → contact → follow-through)
  6. Compute peak/average angles, symmetry score, stroke count
  7. Return TennisTelemetry

MediaPipe landmark indices (33-point body model):
  0  nose        11 left_shoulder   12 right_shoulder
  13 left_elbow  14 right_elbow     15 left_wrist     16 right_wrist
  17 left_pinky  18 right_pinky     19 left_index     20 right_index
  23 left_hip    24 right_hip       25 left_knee      26 right_knee
  27 left_ankle  28 right_ankle
"""

import math
import tempfile
import os
import logging
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import mediapipe as mp
import httpx

from .models import (
    TennisTelemetry,
    JointAngles,
    StrokePhaseData,
    StrokePhase,
    DominantStroke,
    AnalyzeRequest,
)

log = logging.getLogger("analyze")

# MediaPipe landmark indices
LM = {
    "nose": 0,
    "left_shoulder": 11, "right_shoulder": 12,
    "left_elbow": 13,    "right_elbow": 14,
    "left_wrist": 15,    "right_wrist": 16,
    "left_index": 19,    "right_index": 20,
    "left_hip": 23,      "right_hip": 24,
    "left_knee": 25,     "right_knee": 26,
    "left_ankle": 27,    "right_ankle": 28,
}

mp_pose = mp.solutions.pose


def angle_between(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle at vertex B formed by rays B→A and B→C, in degrees."""
    ba = a - b
    bc = c - b
    cosine = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    return float(math.degrees(math.acos(np.clip(cosine, -1.0, 1.0))))


def lm_to_np(landmark) -> np.ndarray:
    return np.array([landmark.x, landmark.y, landmark.z])


def extract_joint_angles(landmarks) -> Optional[JointAngles]:
    """Extract tennis-relevant joint angles from MediaPipe landmarks."""
    try:
        lms = landmarks.landmark

        # Determine dominant (racket) side by which wrist is higher (lower y = higher)
        lw = lm_to_np(lms[LM["left_wrist"]])
        rw = lm_to_np(lms[LM["right_wrist"]])
        use_right = rw[1] < lw[1]  # right wrist is higher → right-handed

        if use_right:
            shoulder = lm_to_np(lms[LM["right_shoulder"]])
            elbow    = lm_to_np(lms[LM["right_elbow"]])
            wrist    = lm_to_np(lms[LM["right_wrist"]])
            index    = lm_to_np(lms[LM["right_index"]])
            hip      = lm_to_np(lms[LM["right_hip"]])
            knee     = lm_to_np(lms[LM["right_knee"]])
            ankle    = lm_to_np(lms[LM["right_ankle"]])
            opp_hip  = lm_to_np(lms[LM["left_hip"]])
        else:
            shoulder = lm_to_np(lms[LM["left_shoulder"]])
            elbow    = lm_to_np(lms[LM["left_elbow"]])
            wrist    = lm_to_np(lms[LM["left_wrist"]])
            index    = lm_to_np(lms[LM["left_index"]])
            hip      = lm_to_np(lms[LM["left_hip"]])
            knee     = lm_to_np(lms[LM["left_knee"]])
            ankle    = lm_to_np(lms[LM["left_ankle"]])
            opp_hip  = lm_to_np(lms[LM["right_hip"]])

        return JointAngles(
            shoulder=angle_between(elbow, shoulder, hip),       # arm lift vs torso
            elbow=angle_between(wrist, elbow, shoulder),         # elbow extension
            wrist=angle_between(index, wrist, elbow),            # wrist cock/snap
            hip=angle_between(shoulder, hip, knee),              # trunk rotation proxy
            knee=angle_between(hip, knee, ankle),                # knee bend/drive
        )
    except Exception as e:
        log.warning(f"angle extraction failed: {e}")
        return None


def classify_stroke_phase(angles_seq: list[JointAngles], idx: int) -> StrokePhase:
    """
    Simple stroke phase classifier based on wrist angle trajectory.
    
    Tennis mechanics:
      Preparation:   wrist cocked (low angle, racket back)
      Contact:       wrist extended, highest velocity point
      Follow-through: wrist decelerates, arm crosses body
    """
    n = len(angles_seq)
    if n == 0:
        return StrokePhase.preparation

    wrist_angles = [a.wrist for a in angles_seq[:idx+1]]
    current = wrist_angles[-1]
    peak = max(wrist_angles)

    if len(wrist_angles) < 3:
        return StrokePhase.preparation

    # Contact = near peak wrist extension
    if current >= peak * 0.95:
        return StrokePhase.contact

    # Follow-through = past peak (wrist decelerating)
    if len(wrist_angles) > 2 and current < peak * 0.85:
        trend = wrist_angles[-1] - wrist_angles[-3]
        if trend < -2:
            return StrokePhase.follow_through

    return StrokePhase.preparation


def compute_symmetry_score(angles_list: list[JointAngles]) -> float:
    """
    Symmetry = consistency of joint angle patterns across the analysis window.
    High variance = asymmetric technique. Returns 0-1.
    """
    if len(angles_list) < 3:
        return 0.5

    fields = ["shoulder", "elbow", "wrist", "hip", "knee"]
    cv_scores = []
    for f in fields:
        vals = [getattr(a, f) for a in angles_list]
        mean = np.mean(vals)
        std  = np.std(vals)
        cv = std / (mean + 1e-8)
        # CV < 0.05 = very consistent; CV > 0.3 = inconsistent
        score = max(0.0, 1.0 - cv / 0.3)
        cv_scores.append(score)

    return float(np.mean(cv_scores))


def detect_dominant_stroke(angles_list: list[JointAngles]) -> DominantStroke:
    """Heuristic stroke type detection from peak shoulder angle."""
    if not angles_list:
        return DominantStroke.unknown

    peak_shoulder = max(a.shoulder for a in angles_list)
    peak_wrist    = max(a.wrist for a in angles_list)

    # Serve: high shoulder elevation
    if peak_shoulder > 170:
        return DominantStroke.serve
    # Volley: elbow stays more bent, less wrist snap
    if peak_wrist < 145:
        return DominantStroke.volley
    # Forehand: larger hip rotation
    avg_hip = np.mean([a.hip for a in angles_list])
    if avg_hip > 160:
        return DominantStroke.forehand
    return DominantStroke.backhand


def count_strokes(angles_list: list[JointAngles]) -> int:
    """Count stroke cycles by detecting wrist angle peaks."""
    if len(angles_list) < 5:
        return max(1, len(angles_list) // 3)

    wrist_seq = np.array([a.wrist for a in angles_list])
    threshold = np.mean(wrist_seq) + 0.3 * np.std(wrist_seq)
    in_stroke = False
    count = 0
    for w in wrist_seq:
        if w > threshold and not in_stroke:
            in_stroke = True
            count += 1
        elif w <= threshold:
            in_stroke = False
    return max(1, count)


async def download_video(url: str, max_duration_s: float = 45.0) -> str:
    """Download video to a temp file. Returns temp file path."""
    suffix = Path(url.split("?")[0]).suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        tmp_path = f.name

    log.info(f"Downloading video: {url}")
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        async with client.stream("GET", url) as r:
            r.raise_for_status()
            with open(tmp_path, "wb") as f:
                async for chunk in r.aiter_bytes(chunk_size=65536):
                    f.write(chunk)

    log.info(f"Downloaded to {tmp_path} ({os.path.getsize(tmp_path) / 1024:.1f} KB)")
    return tmp_path


def analyze_video_file(
    video_path: str,
    video_url: str,
    sample_rate: int = 3,
    max_duration_s: float = 45.0,
) -> TennisTelemetry:
    """
    Core MediaPipe analysis. Runs synchronously — call from thread pool in async context.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_ms = (total_frames / fps) * 1000
    max_frames = int(min(total_frames, max_duration_s * fps))

    log.info(f"Video: {fps:.1f}fps, {total_frames} frames, {duration_ms/1000:.1f}s")

    angles_list: list[JointAngles] = []
    phase_data: list[StrokePhaseData] = []
    prev_wrist_y: Optional[float] = None
    frame_idx = 0
    analyzed = 0

    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,         # 0=lite, 1=full, 2=heavy — balanced for hackathon
        smooth_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:
        while frame_idx < max_frames:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % sample_rate != 0:
                frame_idx += 1
                continue

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(rgb)

            if results.pose_landmarks:
                angles = extract_joint_angles(results.pose_landmarks)
                if angles:
                    angles_list.append(angles)
                    timestamp_ms = (frame_idx / fps) * 1000

                    # Wrist velocity (pixel-space, simplified)
                    rw = results.pose_landmarks.landmark[LM["right_wrist"]]
                    wrist_vel = None
                    if prev_wrist_y is not None:
                        wrist_vel = abs(rw.y - prev_wrist_y) * frame.shape[0] * fps
                    prev_wrist_y = rw.y

                    phase = classify_stroke_phase(angles_list, len(angles_list) - 1)
                    phase_data.append(StrokePhaseData(
                        phase=phase,
                        frame_index=frame_idx,
                        timestamp_ms=timestamp_ms,
                        angles=angles,
                        wrist_velocity_px=wrist_vel,
                    ))
                    analyzed += 1

            frame_idx += 1

    cap.release()

    if not angles_list:
        raise ValueError("No pose landmarks detected — ensure video contains a visible person")

    peak = JointAngles(
        shoulder=max(a.shoulder for a in angles_list),
        elbow=max(a.elbow for a in angles_list),
        wrist=max(a.wrist for a in angles_list),
        hip=max(a.hip for a in angles_list),
        knee=max(a.knee for a in angles_list),
    )
    avg = JointAngles(
        shoulder=float(np.mean([a.shoulder for a in angles_list])),
        elbow=float(np.mean([a.elbow for a in angles_list])),
        wrist=float(np.mean([a.wrist for a in angles_list])),
        hip=float(np.mean([a.hip for a in angles_list])),
        knee=float(np.mean([a.knee for a in angles_list])),
    )

    # Keep only representative phase snapshots (one per phase type)
    key_phases = _select_key_phases(phase_data)

    return TennisTelemetry(
        video_url=video_url,
        duration_ms=duration_ms,
        frames_analyzed=analyzed,
        fps=fps,
        stroke_phases=key_phases,
        peak_angles=peak,
        avg_angles=avg,
        symmetry_score=compute_symmetry_score(angles_list),
        dominant_stroke=detect_dominant_stroke(angles_list),
        stroke_count=count_strokes(angles_list),
        analysis_notes=f"Analyzed {analyzed} frames at {fps:.0f}fps ({sample_rate}x sampling)",
        is_mock=False,
    )


def _select_key_phases(phases: list[StrokePhaseData]) -> list[StrokePhaseData]:
    """Pick the most representative frame for each phase type."""
    selected: dict[str, StrokePhaseData] = {}
    for p in phases:
        pv = p.phase if isinstance(p.phase, str) else p.phase.value
        if pv not in selected:
            selected[pv] = p
        else:
            # Prefer the frame with highest wrist angle (most action)
            if p.angles.wrist > selected[pv].angles.wrist:
                selected[pv] = p
    return list(selected.values())
