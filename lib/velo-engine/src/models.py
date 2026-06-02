from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum


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


class JointAngles(BaseModel):
    shoulder: float = Field(description="Elbow-shoulder-hip angle in degrees")
    elbow: float = Field(description="Wrist-elbow-shoulder angle in degrees")
    wrist: float = Field(description="Index-wrist-elbow angle in degrees")
    hip: float = Field(description="Shoulder-hip-knee angle in degrees")
    knee: float = Field(description="Hip-knee-ankle angle in degrees")


class StrokePhaseData(BaseModel):
    phase: StrokePhase
    frame_index: int
    timestamp_ms: float
    angles: JointAngles
    wrist_velocity_px: Optional[float] = None


class TennisTelemetry(BaseModel):
    video_url: str
    duration_ms: float
    frames_analyzed: int
    fps: float
    stroke_phases: list[StrokePhaseData]
    peak_angles: JointAngles
    avg_angles: JointAngles
    symmetry_score: float = Field(ge=0, le=1, description="0=asymmetric, 1=perfect symmetry")
    dominant_stroke: DominantStroke
    stroke_count: int
    analysis_notes: Optional[str] = None
    is_mock: bool = False

    class Config:
        use_enum_values = True


class AnalyzeRequest(BaseModel):
    video_url: str = Field(description="IPFS gateway URL or direct video URL")
    video_cid: Optional[str] = Field(default=None, description="Original IPFS CID for reference")
    max_duration_s: float = Field(default=45.0, description="Max video duration to analyze (seconds)")
    sample_rate: int = Field(default=3, description="Analyze every Nth frame (higher = faster)")


class AnalyzeResponse(TennisTelemetry):
    pass
