# velo-engine

Python FastAPI microservice that runs Google MediaPipe Pose on tennis videos and returns structured biomechanical telemetry for the Velo agent runner.

## What it does

```
POST /analyze { video_url, video_cid }
  → Downloads video from IPFS gateway
  → Runs MediaPipe Pose frame-by-frame (every Nth frame)
  → Extracts joint angles: shoulder, elbow, wrist, hip, knee
  → Classifies stroke phases: preparation → contact → follow_through
  → Detects dominant stroke: forehand / backhand / serve / volley
  → Computes peak angles, average angles, symmetry score, stroke count
  → Returns TennisTelemetry JSON
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
  -d '{"video_url": "https://gateway.pinata.cloud/ipfs/YOUR_CID"}'
```

## Docker (Koyeb deployment)

```bash
docker build -t velo-engine .
docker run -p 8000:8000 velo-engine
```

## Telemetry output schema

```json
{
  "video_url": "https://...",
  "duration_ms": 42000,
  "frames_analyzed": 63,
  "fps": 30,
  "stroke_phases": [
    {
      "phase": "preparation|contact|follow_through",
      "frame_index": 8,
      "timestamp_ms": 267,
      "angles": {
        "shoulder": 95.2,
        "elbow": 112.4,
        "wrist": 161.3,
        "hip": 168.7,
        "knee": 147.1
      }
    }
  ],
  "peak_angles": { ... },
  "avg_angles": { ... },
  "symmetry_score": 0.72,
  "dominant_stroke": "forehand",
  "stroke_count": 3,
  "analysis_notes": "...",
  "is_mock": false
}
```

## Joint angle definitions

| Joint | Measurement |
|-------|------------|
| Shoulder | Elbow → Shoulder → Hip (arm lift vs torso) |
| Elbow | Wrist → Elbow → Shoulder (extension/flexion) |
| Wrist | Index → Wrist → Elbow (wrist cock/snap) |
| Hip | Shoulder → Hip → Knee (trunk rotation proxy) |
| Knee | Hip → Knee → Ankle (knee drive/bend) |

## Notes

- Uses MediaPipe Pose `model_complexity=1` (balanced accuracy/speed)
- Dominant side detected automatically (racket wrist = higher wrist)
- Videos capped at 45s — more than enough for a rally or drill
- `is_mock: false` in production output, `true` when agent uses synthetic fallback
