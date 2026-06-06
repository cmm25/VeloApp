"""
Backbone-agnostic tennis kinematics + telemetry helpers.

These functions operate purely on `JointAngles` sequences (degrees) and never
touch a specific pose backbone. Both the YOLO engine (`yolo_analyze.py`, the
going-forward Tier-1 path) and any future engine reuse them, so the tennis
logic lives in one place.

NOTE: `analyze.py` (the deprecated MediaPipe failsafe) keeps its own frozen
copies of these helpers and is intentionally left untouched — do not edit it.
New work goes here.
"""

import math
from functools import lru_cache
from typing import Optional

import numpy as np
from scipy.signal import butter, filtfilt, find_peaks

from .models import (
    JointAngles,
    StrokePhaseData,
    StrokePhase,
    DominantStroke,
)


def _fsum_mean_std(vals: list[float]) -> tuple[float, float]:
    """Order-independent (math.fsum) mean + population std — deterministic across
    thread/reduction order, unlike np.mean/np.std."""
    n = len(vals)
    if n == 0:
        return 0.0, 0.0
    mean = math.fsum(vals) / n
    var = math.fsum((v - mean) ** 2 for v in vals) / n
    return mean, math.sqrt(var)


def _norm(v: list[float]) -> float:
    return math.sqrt(math.fsum(x * x for x in v))


def angle_between(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle at vertex B formed by rays B→A and B→C, in degrees. 2D or N-D.

    Scalar math (no BLAS np.dot, no FMA dispatch) + math.fsum + round(6) so the value
    is stable across CPU microarchitectures, not just thread counts. Handles 2D (YOLO
    COCO-17) and 3D (MediaPipe) inputs. Inputs are pre-quantized keypoints (see
    smooth_keypoints), so this is the deterministic angle source."""
    ba = [float(a[i] - b[i]) for i in range(len(a))]
    bc = [float(c[i] - b[i]) for i in range(len(b))]
    dot = math.fsum(ba[i] * bc[i] for i in range(len(ba)))
    n = _norm(ba) * _norm(bc) + 1e-8
    return round(math.degrees(math.acos(max(-1.0, min(1.0, dot / n)))), 6)


def angle_to_axis(a: np.ndarray, b: np.ndarray, axis: np.ndarray) -> float:
    """
    Angle (deg) between segment A→B and a fixed world `axis`. 2D or N-D. Scalar+fsum+round(6).

    Used for the forearm-orientation wrist proxy: COCO-17 has no hand/finger
    keypoint, so true wrist-snap (index-wrist-elbow) is not measurable from body
    keypoints alone. We instead report the hitting forearm's orientation vs the
    image vertical — a real, reproducible kinematic signal that tracks across
    stroke phases. It is upgraded to true wrist-snap once the racket-tip
    keypoint is added (P2).
    """
    v = [float(b[i] - a[i]) for i in range(len(a))]
    ax = [float(axis[i]) for i in range(len(axis))]
    dot = math.fsum(v[i] * ax[i] for i in range(len(v)))
    n = _norm(v) * _norm(ax) + 1e-8
    return round(math.degrees(math.acos(max(-1.0, min(1.0, dot / n)))), 6)


def classify_stroke_phase(angles_seq: list[JointAngles], idx: int) -> StrokePhase:
    """
    Stroke phase from wrist-proxy angle trajectory.

    Preparation:    racket back (low angle)
    Contact:        near peak extension (highest velocity point)
    Follow-through: past peak, decelerating
    """
    n = len(angles_seq)
    if n == 0:
        return StrokePhase.preparation

    wrist_angles = [a.wrist for a in angles_seq[: idx + 1]]
    current = wrist_angles[-1]
    peak = max(wrist_angles)

    if len(wrist_angles) < 3:
        return StrokePhase.preparation

    if current >= peak * 0.95:
        return StrokePhase.contact

    if len(wrist_angles) > 2 and current < peak * 0.85:
        trend = wrist_angles[-1] - wrist_angles[-3]
        if trend < -2:
            return StrokePhase.follow_through

    return StrokePhase.preparation


def compute_consistency_score(angles_list: list[JointAngles]) -> float:
    """Consistency of joint-angle patterns across the window. 0=variable, 1=consistent."""
    if len(angles_list) < 3:
        return 0.5

    fields = ["shoulder", "elbow", "wrist", "hip", "knee"]
    cv_scores = []
    for f in fields:
        vals = [float(getattr(a, f)) for a in angles_list]
        mean = math.fsum(vals) / len(vals)
        var = math.fsum((v - mean) ** 2 for v in vals) / len(vals)
        cv = math.sqrt(var) / (mean + 1e-8)
        cv_scores.append(max(0.0, 1.0 - cv / 0.3))

    return round(math.fsum(cv_scores) / len(cv_scores), 6)


def compute_symmetry_score(angles_list: list[JointAngles]) -> float:
    """Deprecated compatibility wrapper for the v1 summary block."""
    return compute_consistency_score(angles_list)


def detect_dominant_stroke(angles_list: list[JointAngles]) -> DominantStroke:
    """Heuristic stroke type from peak shoulder/wrist + average hip angle."""
    if not angles_list:
        return DominantStroke.unknown

    peak_shoulder = max(a.shoulder for a in angles_list)
    peak_wrist = max(a.wrist for a in angles_list)

    if peak_shoulder > 170:
        return DominantStroke.serve
    if peak_wrist < 145:
        return DominantStroke.volley
    avg_hip = round(math.fsum(a.hip for a in angles_list) / len(angles_list), 6)
    if avg_hip > 160:
        return DominantStroke.forehand
    return DominantStroke.backhand


def count_strokes(angles_list: list[JointAngles]) -> int:
    """Count stroke cycles via wrist-proxy peak detection."""
    if len(angles_list) < 5:
        return max(1, len(angles_list) // 3)

    wrist_seq = [float(a.wrist) for a in angles_list]
    _m, _s = _fsum_mean_std(wrist_seq)
    threshold = round(_m + 0.3 * _s, 6)
    in_stroke = False
    count = 0
    for w in wrist_seq:
        if w > threshold and not in_stroke:
            in_stroke = True
            count += 1
        elif w <= threshold:
            in_stroke = False
    return max(1, count)


def stroke_windows(angles_list: list[JointAngles], frame_indices: list[int]) -> list[tuple[int, int, int]]:
    """
    Segment wrist-proxy peaks into stroke windows.

    Returns (start_idx, peak_idx, end_idx) over the sampled angle sequence.
    """
    n = len(angles_list)
    if n == 0:
        return []
    if n < 5:
        return [(0, max(0, n // 2), n - 1)]

    wrist_seq = np.array([a.wrist for a in angles_list], dtype=float)
    _m, _s = _fsum_mean_std([float(x) for x in wrist_seq])
    threshold = round(_m + 0.3 * _s, 6)
    peaks: list[int] = []
    for i in range(1, n - 1):
        if wrist_seq[i] >= threshold and wrist_seq[i] >= wrist_seq[i - 1] and wrist_seq[i] >= wrist_seq[i + 1]:
            if not peaks or i - peaks[-1] >= 2:
                peaks.append(i)
            elif wrist_seq[i] > wrist_seq[peaks[-1]]:
                peaks[-1] = i

    if not peaks:
        peak = int(np.argmax(wrist_seq))
        return [(0, peak, n - 1)]

    windows: list[tuple[int, int, int]] = []
    for idx, peak in enumerate(peaks):
        prev_peak = peaks[idx - 1] if idx > 0 else 0
        next_peak = peaks[idx + 1] if idx < len(peaks) - 1 else n - 1
        start = 0 if idx == 0 else int((prev_peak + peak) // 2)
        end = n - 1 if idx == len(peaks) - 1 else int((peak + next_peak) // 2)
        windows.append((start, peak, end))
    return windows


def select_key_phases(phases: list[StrokePhaseData]) -> list[StrokePhaseData]:
    """Pick the most representative frame for each phase type."""
    selected: dict[str, StrokePhaseData] = {}
    for p in phases:
        pv = p.phase if isinstance(p.phase, str) else p.phase.value
        if pv not in selected:
            selected[pv] = p
        elif p.angles.wrist > selected[pv].angles.wrist:
            selected[pv] = p
    return list(selected.values())


def summarize_angles(angles_list: list[JointAngles]) -> tuple[JointAngles, JointAngles]:
    """Return (peak, avg) JointAngles over the sequence."""
    peak = JointAngles(
        shoulder=max(a.shoulder for a in angles_list),
        elbow=max(a.elbow for a in angles_list),
        wrist=max(a.wrist for a in angles_list),
        hip=max(a.hip for a in angles_list),
        knee=max(a.knee for a in angles_list),
    )
    n = len(angles_list)
    avg = JointAngles(
        shoulder=round(math.fsum(a.shoulder for a in angles_list) / n, 6),
        elbow=round(math.fsum(a.elbow for a in angles_list) / n, 6),
        wrist=round(math.fsum(a.wrist for a in angles_list) / n, 6),
        hip=round(math.fsum(a.hip for a in angles_list) / n, 6),
        knee=round(math.fsum(a.knee for a in angles_list) / n, 6),
    )
    return peak, avg


# ─────────────────────────────────────────────────────────────────────────────
# Signal layer: deterministic smoothing, segment speed, kinematic sequence,
# validity gates. All pure-NumPy/SciPy with FIXED parameters → bit-reproducible,
# so the on-chain telemetry stays auditable (no stochastic post-processing).
#
# These operate on raw keypoint position SERIES (not JointAngles), because the
# kinematic-sequence construct needs segment velocities, which angles discard.
# They take generic point arrays so kinematics.py stays backbone-neutral; the
# caller maps COCO indices → segments.
# ─────────────────────────────────────────────────────────────────────────────

BUTTER_ORDER = 4
BUTTER_CUTOFF_HZ = 8.0  # sports-biomech standard (zero-phase low-pass); see AthletePose3D
SMOOTHING_LABEL = "butterworth4_zerophase_8hz"
# filtfilt requires len(x) > padlen, where default padlen = 3*max(len(a),len(b)) and
# len(a)=len(b)=BUTTER_ORDER+1. So we need len >= 3*(order+1)+1 (= 16 for order 4).
_FILTFILT_MIN_LEN = 3 * (BUTTER_ORDER + 1) + 1
_KP_GRID_DP = 2  # round smoothed keypoints to 0.01px before geometry (R6/a1: cross-arch buffer)


@lru_cache(maxsize=16)
def _butter_coeffs(wn_key: float, order: int):
    """Frozen Butterworth coefficients — butter() runs LAPACK root-finding per call;
    caching on a rounded wn removes that as a per-run variance source (R7)."""
    return butter(order, wn_key, btype="low")


def smooth_keypoints(xy_seq: np.ndarray, fps_effective: float) -> np.ndarray:
    """
    Zero-phase Butterworth low-pass on each (keypoint, axis) channel.

    Zero-phase (filtfilt) introduces NO peak-time shift — critical for the
    peak-velocity claim — and is deterministic given fixed coefficients. Chosen
    over the One-Euro filter, which is causal (cannot be zero-lag) and is the
    wrong tool for a persisted/on-chain number; One-Euro is only appropriate for
    a live preview path.

    xy_seq: (T, K, 2) pixel coordinates. Returns smoothed (T, K, 2).
    No-op (returns input) when too few frames for filtfilt padding, or when the
    cutoff is not below Nyquist (e.g. ~6fps source can't be low-passed at 8Hz —
    honest: there is nothing to filter that wouldn't destroy signal).
    """
    arr = np.asarray(xy_seq, dtype=float)
    # Quantize coordinates to a fixed grid BEFORE geometry (the round-keypoints-before-
    # geometry mandate) so identical rounded inputs → bit-identical angles across arch.
    if arr.ndim != 3 or arr.shape[0] < _FILTFILT_MIN_LEN or fps_effective <= 0:
        return np.round(arr, _KP_GRID_DP)
    nyq = 0.5 * fps_effective
    wn = BUTTER_CUTOFF_HZ / nyq
    if wn >= 1.0:
        return np.round(arr, _KP_GRID_DP)  # cutoff above Nyquist → no meaningful low-pass
    b, a = _butter_coeffs(round(wn, 9), BUTTER_ORDER)
    # Defense-in-depth: cap padlen below the series length so a borderline window
    # can never raise even if the guard above is ever loosened.
    padlen = min(3 * max(len(a), len(b)), arr.shape[0] - 1)
    out = arr.copy()
    for k in range(arr.shape[1]):
        for ax in range(2):
            out[:, k, ax] = filtfilt(b, a, arr[:, k, ax], padlen=padlen)
    return np.round(out, _KP_GRID_DP)


def point_speed_series(points: np.ndarray, valid: np.ndarray, fps_effective: float) -> np.ndarray:
    """
    Central-difference speed (px/s) of a point trajectory. Central difference
    cancels first-order phase shift. Endpoints and frames adjacent to invalid
    samples are NaN. `points` (T,2), `valid` (T,) bool.
    """
    pts = np.asarray(points, dtype=float)
    T = pts.shape[0]
    speeds = np.full(T, np.nan)
    if T < 3 or fps_effective <= 0:
        return speeds
    dt = 1.0 / fps_effective
    for t in range(1, T - 1):
        if valid[t - 1] and valid[t + 1]:
            dx = float(pts[t + 1, 0] - pts[t - 1, 0])
            dy = float(pts[t + 1, 1] - pts[t - 1, 1])
            speeds[t] = round(math.hypot(dx, dy) / (2.0 * dt), 6)  # scalar + round → arch-stable
    return speeds


def peak_speed(speeds: np.ndarray) -> tuple[Optional[float], Optional[int]]:
    """
    Robust peak of a (possibly NaN-laden) speed series: prominence-gated
    find_peaks, falling back to argmax. Returns (peak_value_px_s, frame_index).
    """
    s = np.asarray(speeds, dtype=float)
    finite = np.isfinite(s)
    if finite.sum() < 3:
        if finite.any():
            i = int(np.nanargmax(s))
            return float(s[i]), i
        return None, None
    floor = float(np.nanmin(s[finite]))
    filled = np.where(finite, s, floor)
    rng = float(np.nanmax(filled) - floor)
    peaks, _ = find_peaks(filled, prominence=max(rng * 0.1, 1e-9))
    if len(peaks) == 0:
        i = int(np.nanargmax(s))
        return float(s[i]), i
    best = int(peaks[int(np.argmax(filled[peaks]))])
    return float(filled[best]), best


# Resolvable hand-off: the trunk→arm lag is ~125ms (≈4 frames @30fps) per the
# tennis-serve IMU literature; adjacent-segment lags (~28ms) are NOT resolvable
# even at 360Hz. We allow a timing claim only if the frame interval can carry it.
_RESOLVABLE_HANDOFF_MS = 125.0
_TIMING_FLOOR_FACTOR = 1.5


def kinematic_sequence(
    points: dict[str, np.ndarray],
    valid: dict[str, np.ndarray],
    torso_len_px: Optional[float],
    fps_effective: float,
) -> dict:
    """
    Honest proximal→distal kinematic-sequence evidence for one stroke window.

    `points` maps {"pelvis","trunk","arm"} → (T,2) smoothed trajectories
    (typically hip-center, shoulder-center, dominant wrist); `valid` maps the
    same keys → (T,) bool confidence masks.

    PRIMARY (always): per-segment peak speed in torso-lengths/sec + a
    `proximal_to_distal_gain` magnitude score (the ball-speed-correlated signal).
    SECONDARY (gated by `timing_resolvable`): a coarse `hips_before_arm` binary
    and a coarse `sequence_coherence_score`. Sub-frame lags are NEVER reported.

    Returns a dict with exactly the KineticChain field names (snake_case).
    """
    order = ["pelvis", "trunk", "arm"]
    interval_ms = (1000.0 / fps_effective) if fps_effective > 0 else None

    peak_v: dict[str, Optional[float]] = {}
    peak_i: dict[str, Optional[int]] = {}
    for seg in order:
        if seg in points and seg in valid:
            v, i = peak_speed(point_speed_series(points[seg], valid[seg], fps_effective))
        else:
            v, i = None, None
        peak_v[seg], peak_i[seg] = v, i

    def _tl(v: Optional[float]) -> Optional[float]:
        if v is None or not torso_len_px or torso_len_px <= 0:
            return None
        return round(float(v) / float(torso_len_px), 6)

    # PRIMARY — speed-gain magnitude (proximal→distal monotonic speed increase).
    steps = [(peak_v[order[k]], peak_v[order[k + 1]]) for k in range(len(order) - 1)]
    valid_steps = [(a, b) for a, b in steps if a is not None and b is not None]
    gain = (sum(1 for a, b in valid_steps if b > a) / len(valid_steps)) if valid_steps else None

    # SECONDARY — coarse timing, gated by resolvability.
    timing_resolvable = bool(
        interval_ms is not None and interval_ms <= (_RESOLVABLE_HANDOFF_MS / _TIMING_FLOOR_FACTOR)
    )
    hips_before_arm: Optional[bool] = None
    coherence: Optional[float] = None
    if timing_resolvable:
        # Gate on INTEGER frame deltas (peak_i), not reconstructed float ms — removes the
        # boundary straddle at exactly 1.5×interval. min_frames = ceil(1.5) = 2 frames.
        min_frames = math.ceil(_TIMING_FLOOR_FACTOR)
        ia, it = peak_i.get("arm"), peak_i.get("trunk")
        if ia is not None and it is not None and abs(ia - it) >= min_frames:
            hips_before_arm = (ia - it) > 0  # trunk (proximal) peaked before the arm
        avail = [s for s in order if peak_i.get(s) is not None]
        if len(avail) >= 2:
            pairs = [(avail[i], avail[j]) for i in range(len(avail)) for j in range(i + 1, len(avail))]
            # Real Kendall-τ remapped to [0,1] over INTEGER peak frames: ties NEUTRAL
            # (excluded) — a frozen/simultaneous-peak subject ⇒ None, not a spurious 1.0.
            concordant = sum(1 for a, b in pairs if peak_i[a] < peak_i[b])
            discordant = sum(1 for a, b in pairs if peak_i[a] > peak_i[b])
            n_nontied = concordant + discordant
            if n_nontied > 0:
                coherence = round(((concordant - discordant) / n_nontied + 1.0) / 2.0, 6)

    if timing_resolvable:
        note = f"granularity≈{interval_ms:.0f}ms; only trunk→arm hand-off is resolvable, adjacent-segment lags are not."
    else:
        note = f"timing UNRESOLVED at granularity≈{interval_ms:.0f}ms (need ≥~12 effective fps); speed-gain only." if interval_ms else "timing unresolved (unknown fps)."

    return {
        "pelvis_peak_tl_per_s": _tl(peak_v["pelvis"]),
        "trunk_peak_tl_per_s": _tl(peak_v["trunk"]),
        "arm_peak_tl_per_s": _tl(peak_v["arm"]),
        "proximal_to_distal_gain": gain,
        "hips_before_arm": hips_before_arm,
        "sequence_coherence_score": coherence,
        "timing_resolvable": timing_resolvable,
        "timing_granularity_ms": interval_ms,
        "notes": note,
    }


def torso_length_px(
    xy_seq: np.ndarray,
    conf_seq: np.ndarray,
    idx_lsh: int,
    idx_rsh: int,
    idx_lhip: int,
    idx_rhip: int,
    kp_conf_min: float,
) -> Optional[float]:
    """Median shoulder-center↔hip-center distance over confident frames (the
    scale normalizer). Median, not per-frame, to resist out-of-plane foreshortening."""
    arr = np.asarray(xy_seq, dtype=float)
    conf = np.asarray(conf_seq, dtype=float)
    ok = (
        (conf[:, idx_lsh] >= kp_conf_min) & (conf[:, idx_rsh] >= kp_conf_min)
        & (conf[:, idx_lhip] >= kp_conf_min) & (conf[:, idx_rhip] >= kp_conf_min)
    )
    if ok.sum() < 1:
        return None
    sc = (arr[ok, idx_lsh] + arr[ok, idx_rsh]) / 2.0
    hc = (arr[ok, idx_lhip] + arr[ok, idx_rhip]) / 2.0
    lens = np.round(np.linalg.norm(sc - hc, axis=1), 4)
    val = round(float(np.median(lens)), 6)
    return val if val > 1e-6 else None


def link_length_outlier_frames(
    xy_seq: np.ndarray,
    conf_seq: np.ndarray,
    segments: list[tuple[int, int]],
    kp_conf_min: float,
    tol: float = 1.15,
) -> tuple[int, np.ndarray]:
    """
    Impossible-elongation validity gate — 2D-CORRECT.

    A 2D projection can only ever SHORTEN a true bone length (foreshortening),
    never lengthen it. So we flag ONLY frames where a segment exceeds its own
    robust observed maximum (95th pct over confident frames) × tol — true
    elongation is physically impossible and signals a detector swap/error.
    Shortening is legitimate and never flagged. Returns (count, per-frame mask).
    """
    arr = np.asarray(xy_seq, dtype=float)
    conf = np.asarray(conf_seq, dtype=float)
    T = arr.shape[0]
    invalid = np.zeros(T, dtype=bool)
    for (i, j) in segments:
        ok = (conf[:, i] >= kp_conf_min) & (conf[:, j] >= kp_conf_min)
        if ok.sum() < 3:
            continue
        lens = np.round(np.linalg.norm(arr[:, i] - arr[:, j], axis=1), 4)
        robust_max = float(np.percentile(lens[ok], 95, method="lower"))  # actual sample, no interp drift
        invalid |= ok & (lens > robust_max * tol)
    return int(invalid.sum()), invalid


def acceleration_outlier_frames(
    xy_seq: np.ndarray,
    fps_effective: float,
    k: float = 6.0,
) -> tuple[int, np.ndarray]:
    """
    Outlier-acceleration validity gate (catches detector flips/ID swaps that
    smoothing didn't absorb). Per keypoint, second-difference magnitude flagged
    when > median + k·MAD (robust, within-clip — no absolute physiological
    constant needed, which 2D px can't define). Returns (count, per-frame mask).
    """
    arr = np.asarray(xy_seq, dtype=float)
    T = arr.shape[0]
    invalid = np.zeros(T, dtype=bool)
    if T < 3 or fps_effective <= 0:
        return 0, invalid
    dt = 1.0 / fps_effective
    for kpt in range(arr.shape[1]):
        p = arr[:, kpt, :]
        acc = np.full(T, np.nan)
        for t in range(1, T - 1):
            acc[t] = round(float(np.linalg.norm(p[t + 1] - 2.0 * p[t] + p[t - 1]) / (dt * dt)), 4)
        fin = np.isfinite(acc)
        if fin.sum() < 3:
            continue
        med = float(np.median(acc[fin]))
        mad = float(np.median(np.abs(acc[fin] - med))) + 1e-9
        invalid |= fin & (acc > med + k * mad)
    return int(invalid.sum()), invalid
