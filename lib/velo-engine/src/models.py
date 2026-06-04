from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


def to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        use_enum_values=True,
    )


class StrokePhase(str, Enum):
    preparation = "preparation"
    contact = "contact"
    follow_through = "follow_through"


class DominantStroke(str, Enum):
    forehand = "forehand"
    backhand = "backhand"
    serve = "serve"
    volley = "volley"
    unknown = "unknown"


class SubjectStrategy(str, Enum):
    auto = "auto"
    most_active = "most_active"
    largest = "largest"
    center = "center"
    roi = "roi"
    track_id = "track_id"


class Handedness(str, Enum):
    right = "right"
    left = "left"


class KeyframeFormat(str, Enum):
    url = "url"
    base64 = "base64"
    none = "none"


class VelocityScaleSource(str, Enum):
    """How a velocity number is scaled. Governs whether metric (mph/m·s) is allowed."""
    torso_length = "torso_length"        # px normalized by shoulder-hip (torso) length → torso-lengths/sec
    court_homography = "court_homography"  # reserved: true metric scale (NOT in production yet)
    pixels = "pixels"                    # raw px/sec — resolution-dependent, within-clip only
    unknown = "unknown"


class SubjectRequest(CamelModel):
    strategy: SubjectStrategy = SubjectStrategy.auto
    handedness_hint: Optional[Handedness] = None
    roi_bbox: Optional[list[float]] = Field(default=None, min_length=4, max_length=4)
    track_id: Optional[int] = None


class AnalyzeRequest(CamelModel):
    video_url: str = Field(description="IPFS gateway URL or direct video URL")
    video_cid: Optional[str] = Field(default=None, description="Original IPFS CID for provenance")
    max_duration_s: float = Field(default=45.0, gt=0, le=120)
    sample_rate: int = Field(default=5, ge=1, le=60)
    subject: SubjectRequest = Field(default_factory=SubjectRequest)
    emit_keyframes: bool = False
    keyframe_format: KeyframeFormat = KeyframeFormat.url
    emit_raw_keypoints: bool = False

    @model_validator(mode="after")
    def validate_subject(self):
        if self.subject.strategy == SubjectStrategy.roi and self.subject.roi_bbox is None:
            raise ValueError("subject.roi_bbox is required when strategy='roi'")
        if self.subject.strategy == SubjectStrategy.track_id and self.subject.track_id is None:
            raise ValueError("subject.track_id is required when strategy='track_id'")
        return self


class JointAngles(CamelModel):
    shoulder: float = Field(description="Elbow-shoulder-hip angle in degrees")
    elbow: float = Field(description="Wrist-elbow-shoulder angle in degrees")
    wrist: float = Field(description="Forearm-orientation proxy angle in degrees")
    hip: float = Field(description="Shoulder-hip-knee angle in degrees")
    knee: float = Field(description="Hip-knee-ankle angle in degrees")
    wrist_is_proxy: bool = True
    racket_face_deg: Optional[float] = None


class StrokePhaseData(CamelModel):
    phase: StrokePhase
    frame_index: int
    timestamp_ms: float
    angles: JointAngles
    wrist_velocity_px: Optional[float] = None


class PhaseSample(CamelModel):
    frame_index: int
    timestamp_ms: float
    angles: JointAngles
    angle_confidence: float = Field(ge=0, le=1)


class StrokePhases(CamelModel):
    preparation: Optional[PhaseSample] = None
    contact: Optional[PhaseSample] = None
    follow_through: Optional[PhaseSample] = None


class Keyframe(CamelModel):
    phase: StrokePhase
    frame_index: int
    timestamp_ms: float
    image_url: Optional[str] = None
    image_base64: Optional[str] = None


class KineticChain(CamelModel):
    """
    Proximal→distal kinematic-sequence evidence for one stroke.

    HONESTY CONTRACT (grounded in biomech literature — Putnam 1993, Bullock 2021,
    tennis-serve IMU PMC11746891): at 30fps single-camera you CANNOT resolve the
    ~20-50ms adjacent-segment peak-velocity ordering (a 360Hz lab study still
    couldn't). The robust, ball-speed-correlated signal is peak-speed MAGNITUDE and
    proximal→distal speed GAIN — not millisecond ordering. So:
      - PRIMARY  : segment peak speeds (TL/s) + `proximal_to_distal_gain` (always emitted).
      - SECONDARY: `hips_before_arm` — the ONLY resolvable hand-off (trunk→arm ≈125ms ≈4
                   frames @30fps), a coarse binary, gated by `timing_resolvable`.
      - `sequence_coherence_score` is a COARSE ordinal (Kendall-τ remapped to [0,1] over
        a handful of segments with ties), emitted only when `timing_resolvable`.
    Anything below 1.5× the frame interval is reported UNRESOLVED, never as a lag.
    """
    pelvis_peak_tl_per_s: Optional[float] = Field(default=None, description="Peak hip-line speed, torso-lengths/sec")
    trunk_peak_tl_per_s: Optional[float] = Field(default=None, description="Peak trunk-line speed, torso-lengths/sec")
    arm_peak_tl_per_s: Optional[float] = Field(default=None, description="Peak hitting-arm speed, torso-lengths/sec")
    proximal_to_distal_gain: Optional[float] = Field(
        default=None, ge=0, le=1,
        description="Fraction of proximal→distal segment steps where peak speed increases (1.0=textbook chain). PRIMARY signal.",
    )
    hips_before_arm: Optional[bool] = Field(
        default=None, description="Coarse gross-timing: did the trunk peak before the arm? Only set when timingResolvable.",
    )
    sequence_coherence_score: Optional[float] = Field(
        default=None, ge=0, le=1,
        description="Coarse ordinal of peak-order agreement (Kendall-τ remapped). Only when timingResolvable; ties common.",
    )
    timing_resolvable: bool = Field(
        default=False, description="True only if the frame interval can support ANY timing claim (≥1.5× inter-segment lag).",
    )
    timing_granularity_ms: Optional[float] = Field(
        default=None, description="Effective ms between analyzed frames in this stroke window (1000/effective_fps).",
    )
    notes: Optional[str] = None


class StrokeTelemetry(CamelModel):
    index: int
    type: DominantStroke
    type_confidence: float = Field(ge=0, le=1)
    start_ms: float
    end_ms: float
    start_frame: int
    end_frame: int
    phases: StrokePhases
    peak_wrist_velocity_px: float
    peak_wrist_velocity_tl_per_s: Optional[float] = Field(
        default=None, description="Peak wrist speed normalized by torso length (torso-lengths/sec). Scale-comparable across clips.",
    )
    kinetic_chain: Optional[KineticChain] = None
    keyframes: list[Keyframe] = Field(default_factory=list)


class EngineInfo(CamelModel):
    backbone: str = Field(
        description="Resolved pose backbone, derived from the loaded weights "
        "(e.g. yolo11s-pose, yolo11l-pose, velo-pose-vN, mediapipe). Must match `weights`.",
    )
    weights: Optional[str] = None
    kp_conf_min: float = Field(ge=0, le=1)
    sample_rate: int
    coco17: bool = True
    racket_keypoints: bool = False
    velocity_scale_source: VelocityScaleSource = Field(
        default=VelocityScaleSource.unknown,
        description="Scale basis for velocities. NEVER emit mph/metric unless this is court_homography.",
    )
    timing_granularity_ms: Optional[float] = Field(
        default=None, description="Clip-level ms between analyzed frames (1000/effective_fps).",
    )
    smoothing: Optional[str] = Field(
        default=None, description="Keypoint smoothing provenance (e.g. 'butterworth4_zerophase_8hz'). Deterministic.",
    )
    normalized_cfr: Optional[bool] = Field(
        default=None, description="True if input was transcoded to constant-frame-rate before analysis (timestamp/determinism anchor).",
    )


class VideoInfo(CamelModel):
    url: str
    cid: Optional[str] = None
    duration_ms: float
    fps: float
    width: int
    height: int
    frames_total: int
    frames_analyzed: int


class SubjectInfo(CamelModel):
    selection_strategy: SubjectStrategy
    track_id: Optional[int] = None
    handedness: Handedness
    handedness_source: Literal["auto", "hint"]
    bbox_mean_norm: list[float] = Field(min_length=4, max_length=4)
    mean_keypoint_confidence: float = Field(ge=0, le=1)
    frames_present: int


class KeypointSpec(CamelModel):
    names: list[str]
    coordinate_system: Literal["normalized"] = "normalized"
    indexing: Literal["coco17", "velo19"] = "coco17"


class Aggregate(CamelModel):
    peak_angles: JointAngles
    avg_angles: JointAngles
    consistency_score: float = Field(ge=0, le=1, description="Temporal repeatability of angles across strokes (NOT left/right symmetry). 0=variable, 1=consistent")
    dominant_stroke: DominantStroke
    stroke_count: int
    kinematic_sequence_valid: Optional[bool] = Field(
        default=None, description="Clip-level: any stroke showed a resolvable, textbook proximal→distal sequence.",
    )
    sequence_coherence_score: Optional[float] = Field(
        default=None, ge=0, le=1, description="Mean coarse peak-order agreement over timing-resolvable strokes.",
    )
    peak_proximal_to_distal_gain: Optional[float] = Field(
        default=None, ge=0, le=1, description="Best proximal→distal speed-gain score across strokes. PRIMARY sequence signal.",
    )


class Quality(CamelModel):
    frames_skipped_low_conf: int
    frames_no_person: int
    frames_multi_person_ambiguous: int
    occlusion_ratio: float = Field(ge=0, le=1)
    mean_keypoint_confidence: float = Field(ge=0, le=1)
    frames_keypoint_outlier: int = Field(
        default=0, description="Frames where a keypoint failed the impossible-elongation / outlier-acceleration validity gate.",
    )
    clip_quality_ok: Optional[bool] = Field(
        default=None, description="Overall deterministic clip-quality gate (enough clean frames + resolvable subject).",
    )


class Summary(CamelModel):
    video_url: str
    duration_ms: float
    frames_analyzed: int
    fps: float
    stroke_phases: list[StrokePhaseData]
    peak_angles: JointAngles
    avg_angles: JointAngles
    symmetry_score: float = Field(ge=0, le=1, description="Deprecated alias for aggregate.consistencyScore")
    dominant_stroke: DominantStroke
    stroke_count: int
    analysis_notes: Optional[str] = None


class TennisTelemetry(CamelModel):
    schema_version: Literal["2.0", "2.1"] = "2.1"
    is_mock: bool = False
    engine: EngineInfo
    video: VideoInfo
    subject: SubjectInfo
    keypoint_spec: KeypointSpec
    strokes: list[StrokeTelemetry]
    aggregate: Aggregate
    quality: Quality
    analysis_notes: Optional[str] = None
    summary: Summary


class AnalyzeResponse(TennisTelemetry):
    pass
