"""
Velo Vision Engine — FastAPI MediaPipe sidecar
Analyzes tennis videos and returns structured pose telemetry.

Run locally:
  pip install -r requirements.txt
  uvicorn src.main:app --reload --port 8000

Run with Docker:
  docker build -t velo-engine .
  docker run -p 8000:8000 velo-engine
"""

import asyncio
import logging
import os
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import AnalyzeRequest, TennisTelemetry
from .analyze import analyze_video_file, download_video

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Velo Vision Engine starting up…")
    yield
    log.info("Velo Vision Engine shutting down…")


app = FastAPI(
    title="Velo Vision Engine",
    description="MediaPipe tennis pose analysis sidecar for Velo agent runner",
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
    """Health check — used by precheck.ts and Docker health check."""
    return {
        "status": "ok",
        "version": "1.0.0",
        "engine": "mediapipe",
    }


@app.post("/analyze", response_model=TennisTelemetry)
async def analyze(req: AnalyzeRequest):
    """
    Analyze a tennis video and return pose telemetry.

    - Downloads the video from the provided URL (IPFS gateway or direct)
    - Runs MediaPipe Pose frame-by-frame
    - Extracts joint angles for the tennis kinetic chain
    - Classifies stroke phases and dominant stroke type
    - Returns TennisTelemetry JSON consumed by the Form Agent
    """
    log.info(f"Analyze request: url={req.video_url[:80]}… cid={req.video_cid}")

    if not req.video_url:
        raise HTTPException(status_code=400, detail="video_url is required")

    tmp_path = None
    try:
        # Download video to temp file
        tmp_path = await download_video(req.video_url, max_duration_s=req.max_duration_s)

        # Run analysis in thread pool (blocking CV2/MediaPipe work)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            analyze_video_file,
            tmp_path,
            req.video_url,
            req.sample_rate,
            req.max_duration_s,
        )

        log.info(
            f"Analysis complete: stroke={result.dominant_stroke} "
            f"frames={result.frames_analyzed} symmetry={result.symmetry_score:.2f}"
        )
        return result

    except ValueError as e:
        log.error(f"Analysis failed (bad input): {e}")
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        log.error(f"Analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis error: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
            log.debug(f"Cleaned up temp file: {tmp_path}")
