# velo-engine

A Python FastAPI service that runs Google MediaPipe Pose on tennis videos and
returns structured biomechanical telemetry for the Velo agent runner. It is
**optional** — set `VISION_MODE=mock` on the runner to skip it and use synthetic
telemetry.

## What it does

```
POST /analyze { video_url, video_cid }
  → download the video → run MediaPipe Pose frame-by-frame
  → extract joint angles (shoulder, elbow, wrist, hip, knee)
  → classify stroke phases and the dominant stroke
  → return TennisTelemetry JSON
```

## Setup

```bash
pip install -r requirements.txt
```

## Run

```bash
uvicorn src.main:app --reload --port 8000
```

Quick check:

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"video_url": "https://gateway.pinata.cloud/ipfs/YOUR_CID"}'
```

## Deploy

Ships a Dockerfile and honors the host's `PORT`. See
[`../../docs/DEPLOY.md`](../../docs/DEPLOY.md).
