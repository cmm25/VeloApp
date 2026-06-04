# velo-engine

Python FastAPI microservice that runs deterministic pose extraction on tennis videos and returns structured biomechanical telemetry for the Velo agent runner.

Tier-1 engine is **YOLO11s-pose** (`VISION_ENGINE=yolo`, default); the original
**MediaPipe** path is kept as a failsafe (`VISION_ENGINE=mediapipe`). Both emit the
identical `TennisTelemetry` schema. See [SMOKE_TEST.md](SMOKE_TEST.md) to validate P0.

## What it does

```
POST /analyze { video_url, video_cid }
  → Downloads video from IPFS gateway
  → Runs YOLO11s-pose tracking (every Nth frame), confidence-gated
  → Selects the student by most-active track (coach+student safe)
  → Extracts joint angles: shoulder, elbow, wrist, hip, knee
  → Segments strokes[] and classifies phases: preparation → contact → follow_through
  → Detects dominant stroke: forehand / backhand / serve / volley
  → Computes peak angles, average angles, consistency score, stroke count
  → Returns TennisTelemetry v2 JSON in camelCase
```

## Setup

```bash
pip install -r requirements.txt
```

## Run locally

```bash
uvicorn src.main:app --reload --port 8000
```

## Test

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"video_url": "https://gateway.pinata.cloud/ipfs/YOUR_CID", "emit_keyframes": true, "keyframe_format": "base64"}'
```

## Docker (Koyeb deployment)

```bash
docker build -t velo-engine .
docker run -p 8000:8000 velo-engine
```

## Telemetry output schema

```json
{
  "schemaVersion": "2.0",
  "isMock": false,
  "engine": { "backbone": "yolo11s-pose", "kpConfMin": 0.5, "sampleRate": 5, "coco17": true, "racketKeypoints": false },
  "video": { "url": "https://...", "durationMs": 42000, "fps": 30, "framesAnalyzed": 63 },
  "subject": { "selectionStrategy": "most_active", "trackId": 3, "handedness": "right", "handednessSource": "auto" },
  "keypointSpec": { "coordinateSystem": "normalized", "indexing": "coco17", "names": ["nose", "..."] },
  "strokes": [{ "index": 0, "type": "forehand", "phases": { "contact": { "frameIndex": 48, "angleConfidence": 0.7 } }, "keyframes": [] }],
  "aggregate": { "peakAngles": { "...": 0 }, "avgAngles": { "...": 0 }, "consistencyScore": 0.72, "dominantStroke": "forehand", "strokeCount": 3 },
  "quality": { "framesSkippedLowConf": 4, "framesNoPerson": 2, "framesMultiPersonAmbiguous": 1, "occlusionRatio": 0.06, "meanKeypointConfidence": 0.78 },
  "summary": { "symmetryScore": 0.72, "...": "deprecated v1-compatible fields" }
}
```

## Joint angle definitions

| Joint | Measurement |
|-------|------------|
| Shoulder | Elbow → Shoulder → Hip (arm lift vs torso) |
| Elbow | Wrist → Elbow → Shoulder (extension/flexion) |
| Wrist | Forearm orientation proxy (COCO-17 has no hand/finger or racket-tip keypoint) |
| Hip | Shoulder → Hip → Knee (trunk rotation proxy) |
| Knee | Hip → Knee → Ankle (knee drive/bend) |

## Notes

- Uses YOLO tracking by default; MediaPipe remains a legacy failsafe
- Dominant side is resolved clip-wide from wrist path length and peak velocity, with `subject.handedness_hint` override
- Videos capped at 45s — more than enough for a rally or drill
- `is_mock: false` in production output, `true` when agent uses synthetic fallback
