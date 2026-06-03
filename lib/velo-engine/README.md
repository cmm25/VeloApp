# velo-engine

The video analysis sidecar for Velo. It receives a tennis video URL from the agent runner, watches the player move frame-by-frame, and sends back a structured breakdown of their technique — joint angles, stroke phases, symmetry, and the dominant stroke type. The agent runner's Form Agent uses that data to write its AI coaching report.

This service is **optional**. If you set `VISION_MODE=mock` on the agent runner, it generates synthetic telemetry instead and the engine is never called. That is enough to run the full on-chain flow during development.

---

## What it does

When a job comes in, the engine:

1. Downloads the video from the IPFS gateway URL (or any direct URL) into a temporary file.
2. Samples every Nth frame (configurable, default every 3rd frame).
3. Runs pose estimation on each sampled frame to locate the player's body landmarks.
4. Calculates five joint angles that matter most for tennis: shoulder lift, elbow extension, wrist cock/snap, hip rotation, and knee drive.
5. Classifies each frame into a stroke phase: preparation, contact, or follow-through.
6. Determines the dominant stroke (forehand, backhand, serve, or volley) from the overall angle pattern.
7. Counts individual stroke cycles.
8. Computes a symmetry score — how consistent the technique is across the clip (0 = highly variable, 1 = very consistent).
9. Returns everything as a single JSON response that the Form Agent converts into coaching language.

---

## Analysis backends

The engine is designed to support more than one pose estimation model. You choose which one runs by setting an environment variable — no code change needed.

### MediaPipe (default)

Google's open-source pose landmark model. Works out of the box with no model file to download or host. Good accuracy for a hackathon or early production deployment. Selected when `ANALYZER_BACKEND=mediapipe` (or when the variable is not set).

### Custom model

For when you have trained your own pose estimation model — for example, one fine-tuned specifically on tennis players, or one that works better on low-quality phone footage.

To plug in your own model:

1. Place your weights file inside `lib/velo-engine/custom_models/`. Any format works as long as you load it in Python (ONNX, TFLite, PyTorch `.pt`, etc.).
2. Set `ANALYZER_BACKEND=custom` and `CUSTOM_MODEL_PATH=custom_models/your_file` in your environment.
3. Open `src/analyzer_custom.py` and implement the two methods described in its comments: one that loads the weights, and one that runs the analysis loop.
4. Rebuild and redeploy.

The custom model must output the same five joint angles as MediaPipe. All the downstream logic (symmetry scoring, stroke counting, phase classification) is model-agnostic and can be reused as-is. The file `src/analyzer_custom.py` contains a detailed implementation guide and explains exactly what each angle represents.

---

## Data types

The response from `/analyze` is a `TennisTelemetry` object. The key fields are:

- **peak_angles / avg_angles** — the five joint angles at their peak and averaged across the clip
- **stroke_phases** — a representative snapshot for each phase (preparation, contact, follow-through) with the angles and timestamp at that moment
- **symmetry_score** — a number from 0 to 1
- **dominant_stroke** — forehand, backhand, serve, or volley
- **stroke_count** — estimated number of strokes in the clip
- **duration_ms / frames_analyzed / fps** — metadata about the video that was processed
- **is_mock** — always `false` from this service; `true` only when the agent runner generates synthetic telemetry

---

## Running locally

Copy the example env file and install dependencies, then start the server.

The service reads `PORT` from the environment (defaults to 8000). To run a quick analysis check, POST a JSON body with a `video_url` field to `/analyze`.

See `.env.example` for all configurable options.

---

## Deploying

The service ships a `Dockerfile` that reads the platform-injected `PORT` variable, so it works on Render and Koyeb free tiers with no changes. It also has a built-in `/healthz` endpoint used by the Docker health check and the agent runner's startup check.

The `render.yaml` at the root of the repository has a ready-to-use service definition for Render. Full deployment instructions, including how to connect the engine to the agent runner, are in `docs/DEPLOY.md`.

For production use, increase `MAX_VIDEO_DURATION_S` and consider `MEDIAPIPE_MODEL_COMPLEXITY=2` (heavier, more accurate) — free tiers run on modest hardware, so the default settings are balanced for speed.
