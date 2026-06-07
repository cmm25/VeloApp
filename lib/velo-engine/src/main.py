"""
Velo Vision Engine — FastAPI pose-analysis sidecar.

Analyzes a tennis video and returns the v2 `TennisTelemetry` contract consumed
by the Velo Form Agent. The backend is selected via VISION_ENGINE (default yolo)
through the analyzer factory; the HTTP layer only ever touches the VideoAnalyzer
interface and serializes camelCase (by_alias) so the agent contract holds.

Run locally:
  pip install -r requirements.txt
  uvicorn src.main:app --reload --port 8000
"""

from . import determinism as _det  # FIRST — sets thread env before numpy/torch import

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .factory import get_analyzer
from .models import AnalyzeRequest, TennisTelemetry
from .video_io import download_video

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("main")

# Resolved backend label for /healthz (matches factory's selection logic).
VISION_ENGINE = (
    os.environ.get("VISION_ENGINE") or os.environ.get("ANALYZER_BACKEND") or "yolo"
).lower().strip()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(f"Velo Vision Engine starting up (engine={VISION_ENGINE})…")
    app.state.warmup_error = None
    _det.pin_determinism()  # single-thread + seed + deterministic algorithms (idempotent)
    try:
        # Eager-build the analyzer so the model warms before the first request.
        await asyncio.get_event_loop().run_in_executor(None, get_analyzer)
        log.info("Analyzer ready.")
    except (NotImplementedError, ValueError):
        # Misconfiguration (demoted/unknown backend) must NOT boot "ok" — fail fast
        # so the orchestrator restarts/alerts instead of serving a lying-healthy process.
        raise
    except Exception as e:  # transient (e.g. weights volume not yet mounted) — degrade, surfaced via /healthz
        app.state.warmup_error = str(e)
        log.warning(f"Analyzer warmup failed (will retry on first request): {e}")
    yield
    log.info("Velo Vision Engine shutting down…")


app = FastAPI(
    title="Velo Vision Engine",
    description="Deterministic tennis pose analysis sidecar (YOLO11-pose, v2 telemetry)",
    version="2.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    """Health check — used by precheck.ts and the Docker HEALTHCHECK."""
    err = getattr(app.state, "warmup_error", None)
    if err:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "version": "2.1.0", "engine": VISION_ENGINE, "error": err},
        )
    return {"status": "ok", "version": "2.1.0", "engine": VISION_ENGINE}


@app.post("/analyze", response_model=TennisTelemetry, response_model_by_alias=True)
async def analyze(req: AnalyzeRequest):
    """
    Analyze a tennis video and return v2 TennisTelemetry.

    Downloads the clip, runs the configured backend (Pass-0 CFR normalization +
    pose + deterministic NumPy kinematics), and returns camelCase telemetry the
    Form Agent validates against its Zod schema.
    """
    log.info(f"Analyze request: url={req.video_url[:80]}… cid={req.video_cid}")

    if not req.video_url:
        raise HTTPException(status_code=400, detail="video_url is required")

    tmp_path = None
    try:
        tmp_path = await download_video(req.video_url, max_duration_s=req.max_duration_s)

        analyzer = get_analyzer()
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: analyzer.analyze_file(
                tmp_path,
                req.video_url,
                req.sample_rate,
                req.max_duration_s,
                req,
            ),
        )

        log.info(
            f"Analysis complete: engine={VISION_ENGINE} stroke={result.aggregate.dominant_stroke} "
            f"frames={result.video.frames_analyzed} consistency={result.aggregate.consistency_score:.2f}"
        )
        return JSONResponse(result.model_dump(by_alias=True, mode="json"))

    except ValueError as e:
        log.error(f"Analysis failed (bad input): {e}")
        raise HTTPException(status_code=422, detail=str(e))
    except NotImplementedError as e:
        log.error(f"Backend not available: {e}")
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.error(f"Analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis error: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
            log.debug(f"Cleaned up temp file: {tmp_path}")


def _to_external_output(t: TennisTelemetry) -> dict:
    """Flatten v2 TennisTelemetry → the simple ExternalModelOutput shape the
    Velo external-model agent validates: {aspect, metrics, observations,
    confidence, notes}. Lets the 'Serve / External' model in the coach's
    direct-hire picker be backed by THIS engine (resolves the contract mismatch:
    the external agent's Zod record rejects nulls, so metrics is all-numeric and
    null fields are dropped). The deterministic telemetryHash is carried in notes.
    """
    agg = t.aggregate
    metrics: dict[str, float] = {}

    def put(key: str, val) -> None:
        if val is not None:
            metrics[key] = round(float(val), 4)

    put("stroke_count", agg.stroke_count)
    put("consistency_score", agg.consistency_score)
    put("peak_proximal_to_distal_gain", agg.peak_proximal_to_distal_gain)
    put("peak_shoulder_deg", agg.peak_angles.shoulder)
    put("peak_elbow_deg", agg.peak_angles.elbow)
    put("peak_hip_deg", agg.peak_angles.hip)
    put("peak_knee_deg", agg.peak_angles.knee)
    put("mean_keypoint_confidence", t.quality.mean_keypoint_confidence)
    vels = [s.peak_wrist_velocity_tl_per_s for s in t.strokes if s.peak_wrist_velocity_tl_per_s is not None]
    if vels:
        put("peak_wrist_velocity_tl_per_s", max(vels))

    obs: list[str] = []
    if t.analysis_notes:
        obs.append(t.analysis_notes[:500])
    if any(s.kinetic_chain and s.kinetic_chain.timing_resolvable is False for s in t.strokes):
        obs.append("Stroke timing is unresolved at this frame rate — chain quality is reported via proximal→distal speed-gain, not millisecond ordering.")
    if agg.peak_angles.wrist_is_proxy:
        obs.append("Wrist angle is a forearm-orientation proxy (no racket keypoints yet).")
    obs.append(f"Velocities are relative ({t.engine.velocity_scale_source}); not metric mph.")

    confidence = max(0.0, min(1.0, float(t.quality.mean_keypoint_confidence)))
    notes = (
        f"telemetryHash={t.telemetry_hash}; backbone={t.engine.backbone}; "
        f"deterministic on the pinned engine image."
    )[:1000]
    return {
        "aspect": str(agg.dominant_stroke),
        "metrics": metrics,
        "observations": obs[:20],
        "confidence": confidence,
        "notes": notes,
    }


@app.post("/analyze-external")
async def analyze_external(req: AnalyzeRequest):
    """Adapter for the external-model agent (the coach's 'Serve / External' model).

    Runs the SAME analysis as /analyze, but returns the flat
    {aspect, metrics, observations, confidence, notes} contract the external agent
    expects — so this one engine can back BOTH models in the direct-hire picker.
    """
    log.info(f"Analyze-external request: url={req.video_url[:80]}… cid={req.video_cid}")
    if not req.video_url:
        raise HTTPException(status_code=400, detail="video_url is required")

    tmp_path = None
    try:
        tmp_path = await download_video(req.video_url, max_duration_s=req.max_duration_s)
        analyzer = get_analyzer()
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: analyzer.analyze_file(tmp_path, req.video_url, req.sample_rate, req.max_duration_s, req),
        )
        return JSONResponse(_to_external_output(result))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.error(f"Analyze-external failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis error: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
