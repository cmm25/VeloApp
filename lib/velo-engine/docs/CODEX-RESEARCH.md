# Velo Vision Engine — Research & Codex Handoff (master)

**Author:** NN/vision lead (Eshaan) prep for Codex. **Date:** 2026-05-30.
**Branch:** `feature-nn`. **Deadline:** ~2026-06-11 (Somnia Agentathon).
**Status:** research complete, **nothing here is executed**. This is a spec for Codex to implement.

This doc is the *why* and the *map*. The actual work is split into two verification-gated
Codex jobs:

- **[CODEX-SPEC-1-schema-ingestion.md](CODEX-SPEC-1-schema-ingestion.md)** — finalize the input/output
  JSON contract (pydantic ↔ Zod), multi-person ingestion, handedness, per-stroke segmentation,
  confidence, keyframe export, and **fix the live snake_case/camelCase contract break**.
- **[CODEX-SPEC-2-nn-testdata-tier2.md](CODEX-SPEC-2-nn-testdata-tier2.md)** — how the NN works,
  MediaPipe(Craig) vs YOLO11 comparison harness, source test videos/datasets, and the Tier-2
  Gemini reasoning consumption contract.

Read this first, then the spec you're assigned.

---

## 1. Mission & data flow

Velo = on-chain tennis coaching analytics. Coach pays → autonomous agents analyze a student's
video → form report → drill prescription → signed receipt (NFT-equiv "proof of work") on Somnia.
**Our half is Tier-1:** turn a video into clean, deterministic biomechanical telemetry that an LLM
layer reasons over. The thesis (from `reference-files-eshaan/velo-architecture-proposal.html`):
**never ask a language model to do geometry — convert pixels to symbols first.** The NN/CV does the
spatial extraction; the LLM only reasons on numbers + labels.

End-to-end path (autonomous):

```
coach pays  ──▶ JobRequested(jobId, athlete, videoCid, deadline)   [Somnia chain]
                         │
            form-agent.ts:handleJobRequested
                         │  resolveVideoUrl(videoCid) → IPFS gateway URL
                         ▼
            POST ${VISION_ENGINE_URL}/analyze   { video_url, video_cid }
                         │                         (THIS ENGINE — lib/velo-engine)
                         ▼
            TennisTelemetry JSON  ◀── YOLO11s-pose + NumPy geometry
                         │
            buildFormAnalysisPrompt(telemetry) → reason() → FormReport  [Somnia LLM / Groq fallback]
                         │
            prescriber-agent → PrescriptionReport → pin IPFS → EIP-712 receipt → chain
```

Manual/dev path: `VISION_MODE=mock` (or local CID) short-circuits to `buildMockTelemetry()`.

**Integration boundary = `TennisTelemetry`.** It is mirrored in two places and consumed by the
prompt builder. Any field change touches all three:
- Python (pydantic): [`src/models.py`](../src/models.py)
- TypeScript (Zod): `lib/velo-agents/src/ai/schemas.ts`
- Prompt consumer: `lib/velo-agents/src/ai/prompts.ts` (`buildFormAnalysisPrompt`)
- Fetch + mock: `lib/velo-agents/src/agents/form-agent.ts` (`fetchTelemetry`, `buildMockTelemetry`)

---

## 2. Ingestion logic — how the engine works today

`POST /analyze` ([`src/main.py`](../src/main.py)) → `download_video()` ([`src/video_io.py`](../src/video_io.py))
→ engine switch (`VISION_ENGINE=yolo|mediapipe`) → analysis in a thread pool → `TennisTelemetry`.

YOLO path ([`src/yolo_analyze.py`](../src/yolo_analyze.py)) per frame:

1. `cv2.VideoCapture`, read fps/total_frames, cap at `max_duration_s`.
2. Sample every `sample_rate`-th frame (default 5).
3. `model(frame)` → `_best_person()` picks **the largest bounding box**.
4. `_extract_joint_angles()` — pick dominant arm (**whichever wrist is higher**), gate every
   required keypoint on `KP_CONF_MIN` (default 0.5); below floor → **skip the frame** (anti-hallucination).
5. 5 angles via NumPy: shoulder, elbow, wrist(*proxy*), hip, knee. Phase classified from wrist-angle trajectory.
6. Aggregate: peak/avg angles, `symmetry_score`, `dominant_stroke`, `stroke_count`, one keyframe per phase.

Tennis math is shared in [`src/kinematics.py`](../src/kinematics.py) (backbone-neutral). MediaPipe path
([`src/analyze.py`](../src/analyze.py)) keeps frozen copies of the same helpers — **do not edit analyze.py**.

### Ingestion gaps / edge cases (these are the work)

| # | Gap | Impact | Where fixed |
|---|-----|--------|-------------|
| G1 | **Single largest bbox** picks one person. Real clips have **coach + student both in frame** (confirmed). Coach can be larger/closer to camera → wrong subject analyzed. | Telemetry describes the wrong person. **Highest-priority correctness bug.** | SPEC-1 |
| G2 | **Handedness** = "higher wrist this frame". Noisy; both arms rise in follow-through; flips per frame. | Wrong dominant arm → garbage angles. | SPEC-1 |
| G3 | **snake_case ↔ camelCase mismatch.** Python emits `video_url`, `dominant_stroke`…; Zod + `form-agent.ts` expect `videoUrl`, `dominantStroke`. `fetchTelemetry` does `(await res.json()) as TennisTelemetry` — **no Zod parse, no key remap**. Only the camelCase mock works; live telemetry yields `undefined` fields in the prompt. | The live pipeline is silently broken (matches Craig's "live there's issues"). | SPEC-1 |
| G4 | **No per-stroke segmentation.** Whole clip → one `dominant_stroke` + one set of phase keyframes. A rally/drill with many strokes collapses to one label. | LLM can't reason per-stroke; deltas are clip-averaged. | SPEC-1 |
| G5 | **No confidence in output.** Per-keypoint conf is used for gating but never emitted. | Downstream can't weight or flag low-trust angles. | SPEC-1 |
| G6 | **No keyframe export.** Tier-2 (Gemini dual-LLM) wants `telemetry + keyframes`. Engine emits no images. | Tier-2 can't be built. | SPEC-1 (emit) + SPEC-2 (consume) |
| G7 | **`symmetry_score` is misnamed** — it actually measures *temporal consistency* (coefficient of variation across frames), not left/right symmetry. Low on mixed-stroke clips is expected, not a flaw. | Misleads the LLM + judges. | SPEC-1 (rename `consistency_score`) |
| G8 | **Wrist angle is a forearm-orientation proxy**, not true wrist-snap. COCO-17 has no hand/finger keypoint. Upgrades to real wrist-snap only when a racket-tip keypoint is added (P2). | Wrist metric is directional, not biomechanical wrist flexion. Document honestly. | SPEC-1 (label) + SPEC-2 (racket kpt) |
| G9 | **No input validation / size limits beyond duration.** No max bytes, no codec check, IPFS gateway can hang (60s download timeout only). | Hostile/huge files; slow Koyeb. | SPEC-1 |

---

## 3. Craig's NN (MediaPipe) vs our YOLO11 pipeline

Both emit the **same `TennisTelemetry`** and share identical tennis math/thresholds. They differ in the
pose backbone and what it can see.

| Dimension | Craig: MediaPipe (`analyze.py`, failsafe) | Ours: YOLO11s-pose (`yolo_analyze.py`, default) |
|-----------|-------------------------------------------|--------------------------------------------------|
| Model | Google MediaPipe Pose, `model_complexity=1` | Ultralytics `yolo11s-pose.pt` (COCO-pretrained) |
| Skeleton | **33 landmarks** (incl. fingers: index/pinky) | **17 COCO keypoints** (no hand/finger) |
| Coords | 3D normalized `(x,y,z)` world landmarks | 2D image `(x,y)` pixels |
| Wrist angle | **True wrist-snap** = index→wrist→elbow (has finger kpt) | **Forearm-orientation proxy** = elbow→wrist vs image vertical |
| Multi-person | Single pose, no subject selection | Largest bbox (also single; see G1) |
| Confidence gating | None (uses MediaPipe internal detection conf only) | **Per-keypoint floor `KP_CONF_MIN`**, skips occluded joints |
| Determinism | Fixed weights, deterministic inference | Fixed weights, deterministic inference |
| Extras available | z-depth, per-landmark visibility, segmentation mask (unused) | per-keypoint conf, native multi-object boxes + tracking (unused) |
| Hosting | mediapipe wheel; heavier import | CPU torch (slim), pre-baked weights in Docker |
| Team verdict (transcript) | "rudimentary… good for proof of concept" — kept as failsafe | going-forward Tier-1; option to fine-tune on tennis data |

**Net:** MediaPipe's only real advantage is the finger keypoint (true wrist-snap) + z-depth. YOLO11 wins on
confidence gating, multi-person/tracking primitives (needed for G1), domain fine-tuning headroom, and lean
CPU hosting. The plan keeps MediaPipe selectable (`VISION_ENGINE=mediapipe`) but builds on YOLO11.
SPEC-2 defines a head-to-head harness so the choice is evidence-based, not asserted.

---

## 4. How "the neural network" actually works (set expectations)

Important framing for the demo and for Codex: **today there is no *trained* Velo model.** The "NN" is a
**stock pose-estimation net (YOLO11s-pose) + deterministic NumPy geometry.** The net localizes joints;
all biomechanics (angles, phases, stroke type, counts) are **plain code**, not learned. That is a feature —
it's reproducible and auditable — but don't oversell "we trained a model."

Optional upgrade path (training scaffold exists in `lib/velo-training/`, **blocked**, see below):
- **P0** ✅ stock YOLO11s-pose swap (done, this engine).
- **P1** fine-tune the 17-keypoint pose on merged tennis datasets to beat the COCO baseline on a held-out split.
- **P2** add **racket butt + tip keypoints** (→ 19 kpts) + `WeightedKeypointLoss` (tighter tolerance on the
  kinetic chain). This is what unlocks **true wrist-snap** and racket-path metrics.

**P1 blocker:** every Roboflow bulk export 404s (metadata↔storage desync on Roboflow's side). Skeleton format
(COCO-17 vs custom) is therefore still unknown. **Recommendation: de-scope the fine-tune for the hackathon** —
stock pose carries the demo. SPEC-2 lists the per-image-API and fork workarounds if pursued. Marlin-2B (old
v1 reasoner) is dropped per Eshaan; reasoning is Gemini/Somnia-LLM.

---

## 5. Decisions locked (from requirements Q&A, 2026-05-30)

1. **Recording:** transcribed to `reference-files-eshaan/transcript.md` (the .mp4 itself is unreviewable by the
   agent). Findings folded into these docs.
2. **Framing:** **coach + student are both visible.** Single-largest-bbox is wrong → SPEC-1 must add real
   subject selection (most-active / tracked person), handedness, and coach exclusion.
3. **Scope:** all four areas (schema+ingestion, Tier-2 contract, test-video sourcing, MediaPipe-vs-YOLO11)
   covered, **split into two verification-gated Codex jobs** (SPEC-1, SPEC-2).
4. **Schema:** **breaking redesign allowed.** `TennisTelemetry` may be restructured for correctness, provided
   pydantic + Zod + prompt + mock are updated together and a back-compat summary block is retained for a clean
   cutover (see SPEC-1).
5. **Granularity:** **full `strokes[]` array** — segment every detected stroke (handles rallies); `aggregate`
   rolls up. Not single-stroke, not whole-clip-only.
6. **Wire format (G3 fix):** **Decision A — engine emits camelCase** (pydantic alias generator); TS does a real
   `TennisTelemetrySchema.parse()`. One source of truth for field names. (Decision B / TS-normalize is rejected.)
7. **No baselines in telemetry:** Tier-1 emits **pure measurements only** (angles, phases, confidence). All
   judgment / target-deltas are the LLM's job. **No `target`/`ideal`/`vs-pro` fields in `TennisTelemetry`.**
   (Rejects Craig's single-baseline compare-to-pro approach, per Eshaan's meeting stance.)
8. **Tier-2 is committed this sprint** (not deferred). Keyframe export (SPEC-1, G6) is **mandatory**, and the
   full Gemini dual-LLM reasoning layer (SPEC-2) is in-scope before the deadline — it's the "unique" judge story.

## 6. Non-functional context (from transcript)

- **No GPU** for the team. Engine hosts on CPU (Koyeb/Render free tier — flag: free boxes ~0.1 vCPU/512MB may
  be too small for YOLO; measure). Vercel won't work (timeouts).
- **Latency is relaxed for the demo** (they pre-trigger jobs ~7–10 min before presenting). Correctness > speed.
- Video arrives **by IPFS CID** from the on-chain event, resolved to a gateway URL. Engine ingests a URL.
- Hackathon framing: **basic single-athlete coaching** ("racket too high", "feet too wide"), not pro
  comparison. Keep telemetry rich but the story simple.

## 7. Secrets

Repo-root `.env` holds `ROBOTFLOW_*` (note the typo'd "ROBO**T**FLOW"), Pinata, agent/wallet keys, Somnia
agent IDs. **Never print values.** Reference by name only.
