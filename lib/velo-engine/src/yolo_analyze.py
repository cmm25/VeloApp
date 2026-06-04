"""
Tier-1 deterministic pose engine — YOLO11s-pose.

Uses Ultralytics tracking so coach+student clips select the most-active player
instead of the largest box. Geometry remains deterministic NumPy math.
"""

import base64
import logging
import os
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from threading import Lock
from typing import Optional

import cv2
import numpy as np

from .kinematics import (
    BUTTER_CUTOFF_HZ,
    SMOOTHING_LABEL,
    _FILTFILT_MIN_LEN,
    acceleration_outlier_frames,
    angle_between,
    angle_to_axis,
    classify_stroke_phase,
    compute_consistency_score,
    detect_dominant_stroke,
    kinematic_sequence,
    link_length_outlier_frames,
    select_key_phases,
    smooth_keypoints,
    stroke_windows,
    summarize_angles,
    torso_length_px,
)
from .models import (
    Aggregate,
    DominantStroke,
    EngineInfo,
    JointAngles,
    Keyframe,
    KeyframeFormat,
    KeypointSpec,
    PhaseSample,
    Quality,
    StrokePhase,
    StrokePhaseData,
    StrokePhases,
    StrokeTelemetry,
    SubjectInfo,
    SubjectRequest,
    SubjectStrategy,
    Summary,
    TennisTelemetry,
    VelocityScaleSource,
    VideoInfo,
)

log = logging.getLogger("yolo_analyze")

COCO17_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]

KP = {name: idx for idx, name in enumerate(COCO17_NAMES)}
_VERTICAL = np.array([0.0, 1.0])
KP_CONF_MIN = float(os.getenv("KP_CONF_MIN", "0.5"))
YOLO_DET_CONF_MIN = float(os.getenv("YOLO_DET_CONF_MIN", "0.1"))
_DEFAULT_WEIGHTS = os.getenv("YOLO_WEIGHTS", "yolo11s-pose.pt")
# Pass-2 dense re-decode inside stroke windows (lifts effective fps so the coarse
# hips-before-arm hand-off becomes resolvable). Gated: heavy on weak CPUs (see R1
# Koyeb latency). On failure it falls back to the coarse pass — never fatal.
DENSE_STROKE_WINDOW = os.getenv("DENSE_STROKE_WINDOW", "1").lower() not in ("0", "false", "no")

_model = None
_model_lock = Lock()


def _resolve_backbone(weights: Optional[str]) -> str:
    """Derive the reported backbone from the loaded weights filename so telemetry
    never advertises a backbone that disagrees with `weights` (the old hardcode bug)."""
    stem = os.path.splitext(os.path.basename(weights or ""))[0]
    return stem or "yolo-pose"


@dataclass
class Observation:
    frame_index: int
    timestamp_ms: float
    xy: np.ndarray
    conf: np.ndarray
    bbox_xywh: np.ndarray
    frame: Optional[np.ndarray] = None


@dataclass
class TrackStats:
    track_id: int
    observations: list[Observation] = field(default_factory=list)
    motion_energy: float = 0.0
    left_wrist_path: float = 0.0
    right_wrist_path: float = 0.0
    left_wrist_peak_velocity: float = 0.0
    right_wrist_peak_velocity: float = 0.0
    higher_left: int = 0
    higher_right: int = 0


def get_model(weights: Optional[str] = None):
    global _model
    with _model_lock:
        if _model is None:
            from ultralytics import YOLO
            w = weights or _DEFAULT_WEIGHTS
            log.info(f"Loading YOLO pose model: {w}")
            _model = YOLO(w)
        return _model


def _mean_conf(conf: np.ndarray) -> float:
    if conf is None or len(conf) == 0:
        return 0.0
    return float(np.mean(conf))


def _bbox_norm(obs: Observation, width: int, height: int) -> list[float]:
    cx, cy, w, h = obs.bbox_xywh.astype(float)
    return [
        float(max(0.0, (cx - w / 2) / width)),
        float(max(0.0, (cy - h / 2) / height)),
        float(min(1.0, w / width)),
        float(min(1.0, h / height)),
    ]


def _mean_bbox_norm(track: TrackStats, width: int, height: int) -> list[float]:
    vals = np.array([_bbox_norm(o, width, height) for o in track.observations], dtype=float)
    return [float(v) for v in vals.mean(axis=0)]


def _mean_bbox_area(track: TrackStats) -> float:
    return float(np.mean([o.bbox_xywh[2] * o.bbox_xywh[3] for o in track.observations]))


def _centrality(track: TrackStats, width: int, height: int) -> float:
    center = np.array([width / 2, height / 2], dtype=float)
    diag = float(np.linalg.norm(np.array([width, height], dtype=float)))
    dists = [np.linalg.norm(o.bbox_xywh[:2] - center) / (diag + 1e-8) for o in track.observations]
    return float(1.0 - np.mean(dists))


def _roi_overlap(track: TrackStats, roi: list[float], width: int, height: int) -> float:
    rx, ry, rw, rh = [float(v) for v in roi]
    r1 = np.array([rx * width, ry * height, (rx + rw) * width, (ry + rh) * height])
    overlaps = []
    for obs in track.observations:
        cx, cy, w, h = obs.bbox_xywh.astype(float)
        b1 = np.array([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2])
        ix1, iy1 = np.maximum(r1[:2], b1[:2])
        ix2, iy2 = np.minimum(r1[2:], b1[2:])
        inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
        union = rw * width * rh * height + w * h - inter + 1e-8
        overlaps.append(inter / union)
    return float(np.mean(overlaps))


def _update_motion(track: TrackStats, obs: Observation, fps: float):
    if track.observations:
        prev = track.observations[-1]
        valid = (obs.conf >= KP_CONF_MIN) & (prev.conf >= KP_CONF_MIN)
        if valid.any():
            disp = np.linalg.norm(obs.xy[valid] - prev.xy[valid], axis=1)
            track.motion_energy += float(np.mean(disp))
        for side in ("left", "right"):
            idx = KP[f"{side}_wrist"]
            if obs.conf[idx] >= KP_CONF_MIN and prev.conf[idx] >= KP_CONF_MIN:
                d = float(np.linalg.norm(obs.xy[idx] - prev.xy[idx]))
                if side == "left":
                    track.left_wrist_path += d
                    track.left_wrist_peak_velocity = max(track.left_wrist_peak_velocity, d * fps)
                else:
                    track.right_wrist_path += d
                    track.right_wrist_peak_velocity = max(track.right_wrist_peak_velocity, d * fps)
    if obs.conf[KP["left_wrist"]] >= KP_CONF_MIN and obs.conf[KP["right_wrist"]] >= KP_CONF_MIN:
        if obs.xy[KP["left_wrist"], 1] < obs.xy[KP["right_wrist"], 1]:
            track.higher_left += 1
        else:
            track.higher_right += 1
    track.observations.append(obs)


def _select_track(
    tracks: dict[int, TrackStats],
    subject: SubjectRequest,
    width: int,
    height: int,
) -> tuple[TrackStats, SubjectStrategy]:
    if not tracks:
        raise ValueError("No person tracks found in the video.")

    candidates = [t for t in tracks.values() if t.observations]
    if subject.strategy == SubjectStrategy.track_id:
        if subject.track_id not in tracks:
            raise ValueError(f"Requested subject.track_id={subject.track_id} was not detected.")
        return tracks[subject.track_id], SubjectStrategy.track_id
    if subject.strategy == SubjectStrategy.roi:
        return max(candidates, key=lambda t: _roi_overlap(t, subject.roi_bbox or [0, 0, 1, 1], width, height)), SubjectStrategy.roi
    if subject.strategy == SubjectStrategy.center:
        return max(candidates, key=lambda t: (_centrality(t, width, height), len(t.observations))), SubjectStrategy.center
    if subject.strategy == SubjectStrategy.largest:
        return max(candidates, key=lambda t: (_mean_bbox_area(t), len(t.observations))), SubjectStrategy.largest

    motion_values = [t.motion_energy for t in candidates]
    if subject.strategy == SubjectStrategy.auto and (max(motion_values) - min(motion_values) < 1.0):
        return max(candidates, key=lambda t: (_mean_bbox_area(t), len(t.observations))), SubjectStrategy.largest
    return max(candidates, key=lambda t: (t.motion_energy, _mean_bbox_area(t))), SubjectStrategy.most_active


def _resolve_handedness(track: TrackStats, hint: Optional[str]) -> tuple[str, str]:
    if hint in ("right", "left"):
        return hint, "hint"
    left_score = track.left_wrist_path + track.left_wrist_peak_velocity
    right_score = track.right_wrist_path + track.right_wrist_peak_velocity
    if abs(left_score - right_score) > 5.0:
        return ("left" if left_score > right_score else "right"), "auto"
    return ("left" if track.higher_left > track.higher_right else "right"), "auto"


def _extract_joint_angles(xy: np.ndarray, conf: np.ndarray, handedness: str) -> tuple[Optional[JointAngles], float]:
    side = "right" if handedness == "right" else "left"
    needed = [f"{side}_shoulder", f"{side}_elbow", f"{side}_wrist", f"{side}_hip", f"{side}_knee", f"{side}_ankle"]
    confs = [float(conf[KP[n]]) for n in needed]
    if any(c < KP_CONF_MIN for c in confs):
        return None, min(confs)

    def pt(name: str) -> np.ndarray:
        return xy[KP[name]].astype(float)

    shoulder = pt(f"{side}_shoulder")
    elbow = pt(f"{side}_elbow")
    wrist = pt(f"{side}_wrist")
    hip = pt(f"{side}_hip")
    knee = pt(f"{side}_knee")
    ankle = pt(f"{side}_ankle")

    return JointAngles(
        shoulder=angle_between(elbow, shoulder, hip),
        elbow=angle_between(wrist, elbow, shoulder),
        wrist=angle_to_axis(elbow, wrist, _VERTICAL),
        hip=angle_between(shoulder, hip, knee),
        knee=angle_between(hip, knee, ankle),
        wrist_is_proxy=True,
        racket_face_deg=None,
    ), float(min(confs))


def _phase_key(phase: StrokePhase) -> str:
    return "follow_through" if phase == StrokePhase.follow_through else str(phase.value if hasattr(phase, "value") else phase)


def _encode_keyframe(frame: np.ndarray) -> Optional[str]:
    ok, jpg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    if not ok:
        return None
    return base64.b64encode(jpg.tobytes()).decode("ascii")


def _segment_points(win_xy: np.ndarray, win_conf: np.ndarray, handedness: str):
    """Map a window's smoothed keypoints → proximal→distal point series + validity.

    pelvis=hip-center, trunk=shoulder-center, arm=hitting wrist. Linear endpoint
    speed normalized by torso length (TL/s) is the honest 2D proxy for the chain
    (distal endpoints move faster); matches the KineticChain *_peak_tl_per_s fields.
    """
    lhip, rhip = KP["left_hip"], KP["right_hip"]
    lsh, rsh = KP["left_shoulder"], KP["right_shoulder"]
    wj = KP[f"{handedness}_wrist"]
    points = {
        "pelvis": (win_xy[:, lhip] + win_xy[:, rhip]) / 2.0,
        "trunk": (win_xy[:, lsh] + win_xy[:, rsh]) / 2.0,
        "arm": win_xy[:, wj],
    }
    m = KP_CONF_MIN
    pelvis_v = (win_conf[:, lhip] >= m) & (win_conf[:, rhip] >= m)
    valid = {
        "pelvis": pelvis_v,
        "trunk": (win_conf[:, lsh] >= m) & (win_conf[:, rsh] >= m),
        "arm": win_conf[:, wj] >= m,
    }
    return points, valid


def _dense_pass(video_path: str, ranges: list[tuple[int, int, int]], ref_centers: dict[int, np.ndarray], fps: float):
    """
    Pass-2: re-decode the (CFR-normalized) clip ONCE and run pose at full rate only
    inside stroke-window source-frame ranges. Subject is re-identified per frame by
    nearest bbox-center to the Pass-1 selected track (no track-ID dependency across
    a fresh decode). Returns {window_id: (smoothed_xy (W,17,2), conf (W,17))}.

    Robust by design: any failure returns {} and the caller falls back to coarse.
    """
    if not ranges or not ref_centers:
        return {}
    model = get_model()
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {}
    ref_idx = sorted(ref_centers.keys())
    collected: dict[int, list] = {wid: [] for wid, _, _ in ranges}
    prev_center: dict[int, np.ndarray] = {}
    fmax = max(f1 for _, _, f1 in ranges)
    fidx = 0
    try:
        while fidx <= fmax:
            ret, frame = cap.read()
            if not ret:
                break
            active = [wid for wid, f0, f1 in ranges if f0 <= fidx <= f1]
            if active:
                res = model.predict(frame, verbose=False, conf=YOLO_DET_CONF_MIN)[0]
                if res.keypoints is not None and res.boxes is not None and len(res.boxes) > 0:
                    boxes = res.boxes.xywh.cpu().numpy()
                    xy_all = res.keypoints.xy.cpu().numpy()
                    conf_all = res.keypoints.conf
                    conf_np = conf_all.cpu().numpy() if conf_all is not None else np.ones((len(boxes), 17), dtype=float)
                    centers = boxes[:, :2]
                    ref = ref_centers[min(ref_idx, key=lambda r: abs(r - fidx))]
                    for wid in active:
                        # Nearest to the Pass-1 reference, biased toward continuity with the
                        # previous dense pick so crossing players (coach+student) can't swap
                        # the subject mid-window when the reference is stale.
                        score = np.linalg.norm(centers - ref, axis=1)
                        if wid in prev_center:
                            score = score + np.linalg.norm(centers - prev_center[wid], axis=1)
                        k = int(np.argmin(score))
                        prev_center[wid] = centers[k]
                        collected[wid].append((fidx, xy_all[k], conf_np[k]))
            fidx += 1
    finally:
        cap.release()

    out = {}
    for wid, lst in collected.items():
        # Require a CONTIGUOUS run long enough to filter. A dropped-detection gap would
        # make the uniform-dt speed math treat the gap as a single-frame step and inflate
        # peak speeds — so on any gap we drop the dense window and fall back to coarse.
        if len(lst) >= _FILTFILT_MIN_LEN:
            fidxs = [f for f, _, _ in lst]
            if fidxs[-1] - fidxs[0] == len(fidxs) - 1:  # strictly consecutive source frames
                win_xy = np.array([a for _, a, _ in lst], dtype=float)
                win_conf = np.array([c for _, _, c in lst], dtype=float)
                out[wid] = (smooth_keypoints(win_xy, fps), win_conf)
    return out


def analyze_video_file(
    video_path: str,
    video_url: str,
    sample_rate: int = 5,
    max_duration_s: float = 45.0,
    video_cid: Optional[str] = None,
    subject: Optional[SubjectRequest] = None,
    emit_keyframes: bool = False,
    keyframe_format: KeyframeFormat = KeyframeFormat.base64,
    emit_raw_keypoints: bool = False,
    normalized_cfr: bool = False,
) -> TennisTelemetry:
    model = get_model()
    subject = subject or SubjectRequest()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration_ms = (total_frames / fps) * 1000
    max_frames = int(min(total_frames, max_duration_s * fps))
    tracks: dict[int, TrackStats] = {}
    no_person = 0
    sampled_frames = 0

    frame_idx = 0
    while frame_idx < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_rate != 0:
            frame_idx += 1
            continue

        sampled_frames += 1
        result = model.track(frame, persist=True, verbose=False, conf=YOLO_DET_CONF_MIN)[0]
        if result.keypoints is None or result.boxes is None or len(result.boxes) == 0:
            no_person += 1
            frame_idx += 1
            continue

        boxes = result.boxes.xywh.cpu().numpy()
        ids = result.boxes.id
        ids_np = ids.cpu().numpy().astype(int) if ids is not None else np.arange(len(boxes), dtype=int)
        xy_all = result.keypoints.xy.cpu().numpy()
        conf_all = result.keypoints.conf
        conf_np = conf_all.cpu().numpy() if conf_all is not None else np.ones((len(boxes), 17), dtype=float)

        for det_idx, track_id in enumerate(ids_np):
            obs = Observation(
                frame_index=frame_idx,
                timestamp_ms=(frame_idx / fps) * 1000,
                xy=xy_all[det_idx],
                conf=conf_np[det_idx],
                bbox_xywh=boxes[det_idx],
                frame=frame.copy() if emit_keyframes else None,
            )
            track = tracks.setdefault(int(track_id), TrackStats(track_id=int(track_id)))
            _update_motion(track, obs, fps)
        frame_idx += 1

    cap.release()

    if not tracks:
        raise ValueError("No person detected in the video.")

    selected, selection_strategy = _select_track(tracks, subject, width, height)
    handedness, handedness_source = _resolve_handedness(selected, subject.handedness_hint)

    # ── Signal layer: validity gates (on RAW) → zero-phase smoothing → geometry.
    sel_obs = selected.observations
    xy_raw = np.array([o.xy for o in sel_obs], dtype=float)       # (T,17,2)
    conf_raw = np.array([o.conf for o in sel_obs], dtype=float)   # (T,17)
    fps_eff = (fps / sample_rate) if sample_rate > 0 else fps      # coarse-pass analyzed fps

    # Validity gates run on RAW coords (they catch detector errors smoothing would mask).
    _LINK_SEGMENTS = [
        (KP["left_shoulder"], KP["left_elbow"]), (KP["left_elbow"], KP["left_wrist"]),
        (KP["right_shoulder"], KP["right_elbow"]), (KP["right_elbow"], KP["right_wrist"]),
        (KP["left_hip"], KP["left_knee"]), (KP["left_knee"], KP["left_ankle"]),
        (KP["right_hip"], KP["right_knee"]), (KP["right_knee"], KP["right_ankle"]),
    ]
    _, link_mask = link_length_outlier_frames(xy_raw, conf_raw, _LINK_SEGMENTS, KP_CONF_MIN)
    _, acc_mask = acceleration_outlier_frames(xy_raw, fps_eff)
    frames_keypoint_outlier = int(np.count_nonzero(link_mask | acc_mask)) if len(sel_obs) else 0

    # Zero-phase Butterworth smoothing on raw (x,y) BEFORE deriving angles/velocities.
    xy_sm = smooth_keypoints(xy_raw, fps_eff)
    smoothed = bool(len(sel_obs) >= _FILTFILT_MIN_LEN and BUTTER_CUTOFF_HZ < 0.5 * fps_eff)
    torso_len = torso_length_px(
        xy_sm, conf_raw, KP["left_shoulder"], KP["right_shoulder"], KP["left_hip"], KP["right_hip"], KP_CONF_MIN
    )

    angles_list: list[JointAngles] = []
    confidences: list[float] = []
    valid_obs: list[Observation] = []
    valid_xy: list[np.ndarray] = []      # smoothed (17,2), aligned with valid_obs/angles_list
    valid_conf: list[np.ndarray] = []
    phase_data: list[StrokePhaseData] = []
    wrist_velocities: list[float] = []
    frames_skipped_low_conf = 0
    prev_wrist: Optional[np.ndarray] = None
    prev_frame_index: Optional[int] = None

    wrist_idx = KP[f"{handedness}_wrist"]
    for i, obs in enumerate(sel_obs):
        sm_xy = xy_sm[i]
        angles, angle_conf = _extract_joint_angles(sm_xy, obs.conf, handedness)
        if angles is None:
            frames_skipped_low_conf += 1
            continue
        wrist_vel = 0.0
        if prev_wrist is not None and prev_frame_index is not None:
            # Δt = actual source-frame gap / fps (robust to skipped low-conf frames),
            # so px/s = ‖Δxy‖ * fps / Δframes — the missing-/sample_rate scaling fix.
            d_frames = max(1, obs.frame_index - prev_frame_index)
            wrist_vel = float(np.linalg.norm(sm_xy[wrist_idx] - prev_wrist) * fps / d_frames)
        prev_wrist = sm_xy[wrist_idx].copy()
        prev_frame_index = obs.frame_index

        angles_list.append(angles)
        confidences.append(angle_conf)
        valid_obs.append(obs)
        valid_xy.append(sm_xy)
        valid_conf.append(obs.conf)
        wrist_velocities.append(wrist_vel)
        phase = classify_stroke_phase(angles_list, len(angles_list) - 1)
        phase_data.append(StrokePhaseData(
            phase=phase,
            frame_index=obs.frame_index,
            timestamp_ms=obs.timestamp_ms,
            angles=angles,
            wrist_velocity_px=wrist_vel,
        ))

    if not angles_list:
        raise ValueError(
            "No reliable pose detected — selected subject did not pass the keypoint-confidence "
            f"floor (KP_CONF_MIN={KP_CONF_MIN}). Ensure the student is visible."
        )

    windows = stroke_windows(angles_list, [o.frame_index for o in valid_obs])
    valid_xy_arr = np.array(valid_xy, dtype=float) if valid_xy else np.empty((0, 17, 2))
    valid_conf_arr = np.array(valid_conf, dtype=float) if valid_conf else np.empty((0, 17))

    # Pass-2: dense re-decode inside stroke windows to lift effective fps (so the
    # trunk→arm hand-off becomes resolvable). Gated on CFR (frame-index alignment
    # only holds on a CFR file). Any failure → coarse fallback, never fatal.
    dense_series: dict[int, tuple] = {}
    if DENSE_STROKE_WINDOW and normalized_cfr and windows:
        try:
            ranges = [(wi, valid_obs[s].frame_index, valid_obs[e].frame_index) for wi, (s, _p, e) in enumerate(windows)]
            ref_centers = {o.frame_index: np.asarray(o.bbox_xywh[:2], dtype=float) for o in sel_obs}
            dense_series = _dense_pass(video_path, ranges, ref_centers, fps)
        except Exception as e:  # noqa: BLE001 — robustness: dense pass is best-effort
            log.warning(f"Dense stroke-window pass failed, using coarse sampling: {e}")
            dense_series = {}

    strokes: list[StrokeTelemetry] = []
    stroke_types: list[DominantStroke] = []
    kinetic_chains: list[dict] = []
    for idx, (start, peak, end) in enumerate(windows):
        window_angles = angles_list[start : end + 1]
        window_phases: dict[str, PhaseSample] = {}
        for seq_i in range(start, end + 1):
            rel_phase = classify_stroke_phase(window_angles, seq_i - start)
            existing = window_phases.get(_phase_key(rel_phase))
            candidate = PhaseSample(
                frame_index=valid_obs[seq_i].frame_index,
                timestamp_ms=valid_obs[seq_i].timestamp_ms,
                angles=angles_list[seq_i],
                angle_confidence=confidences[seq_i],
            )
            if existing is None or angles_list[seq_i].wrist > existing.angles.wrist:
                window_phases[_phase_key(rel_phase)] = candidate

        if "contact" not in window_phases:
            window_phases["contact"] = PhaseSample(
                frame_index=valid_obs[peak].frame_index,
                timestamp_ms=valid_obs[peak].timestamp_ms,
                angles=angles_list[peak],
                angle_confidence=confidences[peak],
            )

        stroke_type = detect_dominant_stroke(window_angles)
        stroke_types.append(stroke_type)
        keyframes: list[Keyframe] = []
        if emit_keyframes and keyframe_format != KeyframeFormat.none:
            contact = window_phases["contact"]
            contact_idx = next((i for i, o in enumerate(valid_obs) if o.frame_index == contact.frame_index), peak)
            image_base64 = None
            image_url = None
            if keyframe_format == KeyframeFormat.base64 and valid_obs[contact_idx].frame is not None:
                image_base64 = _encode_keyframe(valid_obs[contact_idx].frame)
            keyframes.append(Keyframe(
                phase=StrokePhase.contact,
                frame_index=contact.frame_index,
                timestamp_ms=contact.timestamp_ms,
                image_url=image_url,
                image_base64=image_base64,
            ))

        # Honest kinematic sequence: dense window (full fps) if available, else coarse.
        if idx in dense_series:
            win_xy_kc, win_conf_kc, kc_fps = (*dense_series[idx], fps)
        else:
            win_xy_kc, win_conf_kc, kc_fps = valid_xy_arr[start : end + 1], valid_conf_arr[start : end + 1], fps_eff
        seg_pts, seg_valid = _segment_points(win_xy_kc, win_conf_kc, handedness)
        kc = kinematic_sequence(seg_pts, seg_valid, torso_len, kc_fps)
        kinetic_chains.append(kc)
        # Keep the per-stroke wrist peak consistent with the kinematic-chain arm peak:
        # when a dense window exists, source BOTH from the dense pass so the telemetry
        # never publishes two different-fps numbers for the same physical wrist.
        if idx in dense_series and kc.get("arm_peak_tl_per_s") is not None and torso_len:
            peak_tl = kc["arm_peak_tl_per_s"]
            peak_px = peak_tl * torso_len
        else:
            peak_px = max(wrist_velocities[start : end + 1] or [0.0])
            peak_tl = (peak_px / torso_len) if (torso_len and torso_len > 0) else None

        strokes.append(StrokeTelemetry(
            index=idx,
            type=stroke_type,
            type_confidence=0.66 if stroke_type != DominantStroke.unknown else 0.25,
            start_ms=valid_obs[start].timestamp_ms,
            end_ms=valid_obs[end].timestamp_ms,
            start_frame=valid_obs[start].frame_index,
            end_frame=valid_obs[end].frame_index,
            phases=StrokePhases(
                preparation=window_phases.get("preparation"),
                contact=window_phases.get("contact"),
                follow_through=window_phases.get("follow_through"),
            ),
            peak_wrist_velocity_px=peak_px,
            peak_wrist_velocity_tl_per_s=peak_tl,
            kinetic_chain=kc,
            keyframes=keyframes,
        ))

    peak_angles, avg_angles = summarize_angles(angles_list)
    consistency = compute_consistency_score(angles_list)
    dominant = Counter(stroke_types).most_common(1)[0][0] if stroke_types else DominantStroke.unknown
    mean_conf = float(np.mean(confidences))
    ambiguous = sum(1 for t in tracks.values() if t.track_id != selected.track_id and t.observations)
    key_phases = select_key_phases(phase_data)

    # Telemetry honesty metadata.
    backbone = _resolve_backbone(_DEFAULT_WEIGHTS)
    scale_source = VelocityScaleSource.torso_length if torso_len else VelocityScaleSource.pixels
    clip_granularity_ms = (1000.0 / fps_eff) if fps_eff > 0 else None

    # Clip-level kinematic-sequence rollups from the per-stroke kinetic chains.
    gains = [kc["proximal_to_distal_gain"] for kc in kinetic_chains if kc.get("proximal_to_distal_gain") is not None]
    coherences = [kc["sequence_coherence_score"] for kc in kinetic_chains if kc.get("sequence_coherence_score") is not None]
    any_resolvable = any(kc.get("timing_resolvable") for kc in kinetic_chains)
    seq_valid = (
        any((kc.get("proximal_to_distal_gain") or 0) >= 0.5 and kc.get("hips_before_arm") is True for kc in kinetic_chains)
        if any_resolvable else None
    )
    agg_gain = max(gains) if gains else None
    agg_coherence = (sum(coherences) / len(coherences)) if coherences else None
    clip_quality_ok = bool(
        len(angles_list) >= 5 and mean_conf >= KP_CONF_MIN and no_person < max(1, sampled_frames) * 0.5
    )

    notes = (
        f"{backbone} · subject=track#{selected.track_id}({selection_strategy.value}) · "
        f"handedness={handedness}({handedness_source}) · wrist=forearm proxy · "
        f"scale={scale_source.value} · granularity≈{clip_granularity_ms:.0f}ms"
        f"{' · cfr' if normalized_cfr else ''} · skippedLowConf={frames_skipped_low_conf}, "
        f"noPerson={no_person}, kpOutlier={frames_keypoint_outlier}."
    )

    aggregate = Aggregate(
        peak_angles=peak_angles,
        avg_angles=avg_angles,
        consistency_score=consistency,
        dominant_stroke=dominant,
        stroke_count=len(strokes),
        kinematic_sequence_valid=seq_valid,
        sequence_coherence_score=agg_coherence,
        peak_proximal_to_distal_gain=agg_gain,
    )
    video = VideoInfo(
        url=video_url,
        cid=video_cid,
        duration_ms=duration_ms,
        fps=fps,
        width=width,
        height=height,
        frames_total=total_frames,
        frames_analyzed=len(angles_list),
    )
    summary = Summary(
        video_url=video_url,
        duration_ms=duration_ms,
        frames_analyzed=len(angles_list),
        fps=fps,
        stroke_phases=key_phases,
        peak_angles=peak_angles,
        avg_angles=avg_angles,
        symmetry_score=consistency,
        dominant_stroke=dominant,
        stroke_count=len(strokes),
        analysis_notes=notes,
    )

    return TennisTelemetry(
        schema_version="2.1",
        is_mock=False,
        engine=EngineInfo(
            backbone=backbone,
            weights=_DEFAULT_WEIGHTS,
            kp_conf_min=KP_CONF_MIN,
            sample_rate=sample_rate,
            coco17=True,
            racket_keypoints=False,
            velocity_scale_source=scale_source,
            timing_granularity_ms=clip_granularity_ms,
            smoothing=SMOOTHING_LABEL if smoothed else None,
            normalized_cfr=normalized_cfr,
        ),
        video=video,
        subject=SubjectInfo(
            selection_strategy=selection_strategy,
            track_id=selected.track_id,
            handedness=handedness,
            handedness_source=handedness_source,
            bbox_mean_norm=_mean_bbox_norm(selected, width, height),
            mean_keypoint_confidence=float(np.mean([_mean_conf(o.conf) for o in selected.observations])),
            frames_present=len(selected.observations),
        ),
        keypoint_spec=KeypointSpec(names=COCO17_NAMES),
        strokes=strokes,
        aggregate=aggregate,
        quality=Quality(
            frames_skipped_low_conf=frames_skipped_low_conf,
            frames_no_person=no_person,
            frames_multi_person_ambiguous=ambiguous,
            occlusion_ratio=float(frames_skipped_low_conf / max(1, sampled_frames)),
            mean_keypoint_confidence=mean_conf,
            frames_keypoint_outlier=frames_keypoint_outlier,
            clip_quality_ok=clip_quality_ok,
        ),
        analysis_notes=notes,
        summary=summary,
    )
