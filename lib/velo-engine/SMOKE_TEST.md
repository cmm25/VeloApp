# P0 Smoke Test — runbook for Codex / Antigravity

**Goal:** prove the new YOLO11s-pose engine (`VISION_ENGINE=yolo`) runs end-to-end,
emits schema-valid `TennisTelemetry`, and lands keypoints on real joints. Then
report results in the template at the bottom so the human can act on them.

**Do NOT** change `KP_CONF_MIN` in committed config. Tuning is a *finding* to
report, not a change to make.

---

## 1. Setup (CPU only — no GPU)

```bash
cd lib/velo-engine
python3 -m venv .venv && source .venv/bin/activate
# CPU torch first (keeps it lean, matches Koyeb):
pip install torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

If `cv2` errors on import (duplicate opencv from ultralytics), fix with:
```bash
pip uninstall -y opencv-python opencv-python-headless && pip install opencv-python-headless==4.10.0.84
```

## 2. Start the engine

```bash
VISION_ENGINE=yolo uvicorn src.main:app --port 8000
# Wait for: "YOLO pose model warmed up."  (first run downloads yolo11s-pose.pt, ~20MB)
curl -s localhost:8000/healthz        # expect: {"status":"ok",...,"engine":"yolo"}
```

## 3. Smoke test — table + schema check (new terminal, same venv)

```bash
cd lib/velo-engine && source .venv/bin/activate
python test_engine.py                  # default GVHMR clip
```
**Capture:** the full table. `status` must be `ok` (NOT `mock!`, NOT `SCHEMA FAIL`).
Record `frames_analyzed` and wall-clock time.

## 4. Latency probe (we deploy on CPU — need real numbers)

```bash
time python test_engine.py --sample-rate 3      # denser
time python test_engine.py --sample-rate 10     # sparser
```
**Capture:** seconds for each. This decides our production `sample_rate`.

## 5. Visual check — does it hallucinate occluded joints?

```bash
python test_engine.py --overlay \
  "https://raw.githubusercontent.com/zju3dv/GVHMR/main/docs/example_video/tennis.mp4"
# writes overlays/frame_*.jpg
```
**Capture:** eyeball 5–6 frames. Are wrists/elbows/hips on the actual body? Any
floating/phantom keypoints? Note frames where the player is partly occluded.

## 6. KP_CONF_MIN sweep (report only — don't commit a change)

```bash
KP_CONF_MIN=0.35 VISION_ENGINE=yolo uvicorn src.main:app --port 8000   # re-run, then re-do step 3
```
Compare `frames_analyzed` and the `skipped` counts in `analysis_notes` at 0.5 vs 0.35.

---

## Report back in THIS format

```
ENGINE BOOT:        ok / failed (error)
HEALTHZ:            engine=____
SMOKE TABLE:        <paste table>
SCHEMA:             ok / FAIL (msg)
FRAMES @ rate3/5/10: ___ / ___ / ___
LATENCY @ rate3/5/10: ___s / ___s / ___s
OVERLAYS:           clean / hallucinations at frames ____
KP_CONF 0.5 vs 0.35: frames ___ vs ___ ; skipped ___ vs ___
DOMINANT_STROKE:    ____ (does it match the clip visually? y/n)
SURPRISES:          <anything weird>
```

Latency at the chosen sample_rate is the number that matters most — it sets
whether CPU-on-Koyeb is acceptable or we revisit the GPU question.
