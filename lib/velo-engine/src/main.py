"""
Velo Vision Engine — FastAPI pose analysis sidecar

Analyzes tennis videos and returns structured biomechanical telemetry for the
Velo agent runner.  The analysis backend is selected at startup via the
ANALYZER_BACKEND environment variable (default: mediapipe).

Run locally:
  pip install -r requirements.txt
  uvicorn src.main:app --reload --port 8000

Run with a custom model:
  ANALYZER_BACKEND=custom CUSTOM_MODEL_PATH=custom_models/model.onnx \
  uvicorn src.main:app --reload --port 8000

Run with Docker:
  docker build -t velo-engine .
  docker run -p 8000:8000 -e ANALYZER_BACKEND=mediapipe velo-engine
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import AnalyzeRequest, TennisTelemetry
from .analyze import download_video
from .factory import get_analyzer

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("main")

_BACKEND = os.environ.get("ANALYZER_BACKEND", "mediapipe").lower().strip()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(f"Velo Vision Engine starting up (backend: {_BACKEND})…")
    get_analyzer()
    yield
    log.info("Velo Vision Engine shutting down…")


app = FastAPI(
    title="Velo Vision Engine",
    description="Tennis pose analysis sidecar for the Velo agent runner",
    version="1.0.0",
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
    return {
        "status": "ok",
        "version": "1.0.0",
        "backend": _BACKEND,
    }


@app.post("/analyze", response_model=TennisTelemetry)
async def analyze(req: AnalyzeRequest):
    """
    Analyze a tennis video and return pose telemetry.

    Downloads the video from the provided URL (IPFS gateway or direct link),
    runs the configured analysis backend frame-by-frame, and returns structured
    TennisTelemetry JSON consumed by the Velo Form Agent.
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
            analyzer.analyze_file,
            tmp_path,
            req.video_url,
            req.sample_rate,
            req.max_duration_s,
        )

        log.info(
            f"Analysis complete: backend={_BACKEND} stroke={result.dominant_stroke} "
            f"frames={result.frames_analyzed} symmetry={result.symmetry_score:.2f}"
        )
        return result

    except ValueError as e:
        log.error(f"Analysis failed (bad input): {e}")
        raise HTTPException(status_code=422, detail=str(e))
    except NotImplementedError as e:
        log.error(f"Backend not implemented: {e}")
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.error(f"Analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis error: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
            log.debug(f"Cleaned up temp file: {tmp_path}")
