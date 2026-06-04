# CODEX SPEC 1 — Finalize I/O Schema + Ingestion (multi-person, handedness, per-stroke)

**Read [CODEX-RESEARCH.md](CODEX-RESEARCH.md) first** (esp. §5 locked decisions). This is a verification-gated
implementation job. **Breaking schema changes are authorized.** You must keep pydantic, Zod, the prompt builder,
and the mock in lockstep.

**Locked decisions that bind this spec:** full `strokes[]` granularity · Decision A camelCase wire format ·
pure-measurements only (no target/ideal fields) · keyframe export is mandatory (Tier-2 is committed).

**Goal:** make `/analyze` produce correct, trustworthy, *per-stroke* telemetry for a **coach+student** video,
and make the **live engine↔agent contract actually work** (it is currently broken — G3).

Owns gaps: **G1, G2, G3, G4, G5, G6(emit), G7, G9.**

---

## 0. The contract break you must fix first (G3)

`lib/velo-agents/src/agents/form-agent.ts:fetchTelemetry` does:

```ts
return (await res.json()) as TennisTelemetry;   // raw cast, no validation, no key remap
```

Python (`src/models.py`, pydantic) serializes **snake_case** (`video_url`, `dominant_stroke`, `peak_angles`…).
Zod `TennisTelemetrySchema` and the prompt builder read **camelCase** (`videoUrl`, `dominantStroke`,
`peakAngles`…). So on the live path every field is `undefined`; only the camelCase `buildMockTelemetry` works.

**DECISION LOCKED — Decision A (engine emits camelCase).** Add a pydantic alias generator
(`alias_generator=to_camel`, `populate_by_name=True`, serialize with `model_dump(by_alias=True)`) so the JSON
wire format is camelCase. TS then calls `TennisTelemetrySchema.parse(await res.json())` (real validation, no
cast). One source of truth for field names. Decision B (TS-normalize) is **rejected** — do not implement it.

**Replace the raw cast with `TennisTelemetrySchema.parse(...)`** so a malformed engine response fails loud,
not silently. This is the #1 acceptance gate.

---

## 1. Finalized INPUT schema — `AnalyzeRequest` v2

Additive over today's request (back-compatible: all new fields optional with safe defaults).

```jsonc
{
  "video_url": "https://gateway.pinata.cloud/ipfs/<cid>",   // required; IPFS gateway or direct
  "video_cid": "bafy…",                                      // optional, for provenance
  "max_duration_s": 45.0,                                    // default 45
  "sample_rate": 5,                                          // analyze every Nth frame; default 5

  // NEW — subject selection for coach+student frames (G1, G2)
  "subject": {
    "strategy": "auto",            // "auto" | "most_active" | "largest" | "center" | "roi" | "track_id"
    "handedness_hint": null,       // "right" | "left" | null  (UI/coach override; null = auto-detect)
    "roi_bbox": null,              // [x,y,w,h] normalized 0–1, used when strategy="roi"
    "track_id": null               // int, used when strategy="track_id"
  },

  // NEW — Tier-2 / debug toggles (G6)
  "emit_keyframes": false,         // export phase keyframe images for the Gemini layer
  "keyframe_format": "url",        // "url" (pin to IPFS, return URL) | "base64" | "none"
  "emit_raw_keypoints": false      // per-frame keypoint arrays (debug/training only; large)
}
```

`strategy` semantics:
- `auto` (default) → run `most_active`, fall back to `largest` if motion energy is ~flat (static drill).
- `most_active` → highest cumulative motion-energy track (the student is the one swinging; the coach films/stands).
- `largest` → today's behavior (largest mean bbox). Kept for A/B + as fallback.
- `center` / `roi` / `track_id` → manual targeting.

---

## 2. Finalized OUTPUT schema — `TennisTelemetry` v2

Restructured for: multi-person provenance, per-stroke segmentation, confidence, racket, keyframes, and a
**flat `summary` block that preserves the current fields** so the cutover doesn't strand the form-agent.

```jsonc
{
  "schemaVersion": "2.0",
  "isMock": false,

  "engine": {
    "backbone": "yolo11s-pose",         // or "mediapipe"
    "weights": "yolo11s-pose.pt",
    "kpConfMin": 0.5,
    "sampleRate": 5,
    "coco17": true,                     // false once racket kpts (P2) added → 19
    "racketKeypoints": false
  },

  "video": {
    "url": "https://…",
    "cid": "bafy…|null",
    "durationMs": 42000,
    "fps": 30.0,
    "width": 1920,
    "height": 1080,
    "framesTotal": 1260,
    "framesAnalyzed": 63
  },

  // WHICH person was analyzed (G1, G2)
  "subject": {
    "selectionStrategy": "most_active",
    "trackId": 3,
    "handedness": "right",             // detected dominant side
    "handednessSource": "auto",        // "auto" | "hint"
    "bboxMeanNorm": [0.41, 0.55, 0.18, 0.62],   // x,y,w,h normalized
    "meanKeypointConfidence": 0.78,
    "framesPresent": 60
  },

  // keypoint contract so downstream knows the coordinate system
  "keypointSpec": {
    "names": ["nose","left_eye","right_eye","left_ear","right_ear","left_shoulder","right_shoulder",
              "left_elbow","right_elbow","left_wrist","right_wrist","left_hip","right_hip",
              "left_knee","right_knee","left_ankle","right_ankle"],   // + "racket_butt","racket_tip" when P2
    "coordinateSystem": "normalized",  // 0–1, origin top-left, y-down
    "indexing": "coco17"
  },

  // PER-STROKE segmentation (G4) — the big structural win
  "strokes": [
    {
      "index": 0,
      "type": "forehand",              // forehand|backhand|serve|volley|unknown
      "typeConfidence": 0.66,
      "startMs": 1200, "endMs": 2100,
      "startFrame": 36, "endFrame": 63,
      "phases": {                       // representative frame per phase (null if not detected)
        "preparation": { "frameIndex": 36, "timestampMs": 1200, "angles": { /* JointAngles */ }, "angleConfidence": 0.8 },
        "contact":     { "frameIndex": 48, "timestampMs": 1600, "angles": { /* JointAngles */ }, "angleConfidence": 0.7 },
        "followThrough":{ "frameIndex": 60, "timestampMs": 2000, "angles": { /* JointAngles */ }, "angleConfidence": 0.6 }
      },
      "peakWristVelocityPx": 412.0,
      "keyframes": [                    // present only when emit_keyframes=true (G6)
        { "phase": "contact", "frameIndex": 48, "timestampMs": 1600, "imageUrl": "https://…|null", "imageBase64": null }
      ]
    }
  ],

  // JointAngles (extended): same 5 + optional confidence + optional racket angle
  // {
  //   "shoulder": 95.2, "elbow": 112.4, "wrist": 161.3, "hip": 168.7, "knee": 147.1,
  //   "wristIsProxy": true,            // forearm-orientation proxy, not true snap (G8)
  //   "racketFaceDeg": null            // null until racket kpts exist (P2)
  // }

  // clip-level rollups
  "aggregate": {
    "peakAngles": { /* JointAngles */ },
    "avgAngles":  { /* JointAngles */ },
    "consistencyScore": 0.72,          // RENAMED from symmetryScore (G7); 0=variable,1=consistent
    "dominantStroke": "forehand",      // most frequent stroke.type across strokes[]
    "strokeCount": 3
  },

  "quality": {
    "framesSkippedLowConf": 4,
    "framesNoPerson": 2,
    "framesMultiPersonAmbiguous": 1,
    "occlusionRatio": 0.06,
    "meanKeypointConfidence": 0.78
  },

  "analysisNotes": "YOLO11s-pose · subject=track#3(most_active) · wrist=forearm proxy · …",

  // BACK-COMPAT: keep the v1 flat shape so form-agent works during cutover.
  // Populate from aggregate + strokes[].phases. Mark deprecated; remove after agents migrate.
  "summary": {
    "videoUrl": "…", "durationMs": 42000, "framesAnalyzed": 63, "fps": 30,
    "strokePhases": [ /* flattened representative phases */ ],
    "peakAngles": { /* JointAngles */ }, "avgAngles": { /* JointAngles */ },
    "symmetryScore": 0.72, "dominantStroke": "forehand", "strokeCount": 3,
    "analysisNotes": "…"
  }
}
```

Field names above are **camelCase on the wire** (assuming Decision A). Mirror them in
`lib/velo-agents/src/ai/schemas.ts` exactly.

---

## 3. Ingestion logic to implement

### 3.1 Subject selection (G1) — the core correctness fix
- Switch detection to **tracking**: `model.track(frame, persist=True)` (Ultralytics ByteTrack) so each person
  keeps a stable `track_id` across frames.
- Per track, accumulate **motion energy** = sum over frames of mean per-keypoint displacement (or wrist/elbow
  displacement specifically — the swinging arm dominates). Also record mean bbox area, mean confidence,
  frame-presence count, centrality.
- `auto`/`most_active` → pick the track with max motion energy (tie-break by bbox area). This separates the
  *student who is playing* from the *coach who is filming/standing*. Honor `largest`/`center`/`roi`/`track_id`.
- Emit the chosen track's stats into `subject{}` and put rejected-person count into
  `quality.framesMultiPersonAmbiguous`.

### 3.2 Handedness (G2)
- Compute over the whole clip, not per frame: the **racket hand = wrist with greater cumulative path length
  AND higher peak velocity**. Fall back to "more frequently-higher wrist" if motion is ambiguous.
- `handedness_hint` overrides; set `subject.handednessSource` accordingly.
- All kinetic-chain angles use the resolved dominant side consistently.

### 3.3 Per-stroke segmentation (G4)
- Detect stroke cycles from the wrist-proxy velocity/angle peaks already computed in `count_strokes`
  (`kinematics.py`). Each peak → one stroke window `[startFrame, endFrame]` around it.
- Within each window, label phases (reuse `classify_stroke_phase`) and classify `type`
  (reuse `detect_dominant_stroke` on that window's angles). `aggregate.dominantStroke` = mode of `strokes[].type`.
- If only one stroke is found, `strokes[]` has length 1 (still valid).

### 3.4 Confidence surfacing (G5)
- Carry per-keypoint conf through; set each phase's `angleConfidence` = min conf of the keypoints used for that
  phase's angles. Populate `quality.meanKeypointConfidence`, `occlusionRatio = framesSkippedLowConf / framesSampled`.

### 3.5 Keyframe export (G6) — MANDATORY (Tier-2 is committed this sprint)
- For each stroke's contact frame (minimum; prep/follow optional), encode the frame. Keyframe export is **not
  optional** — Tier-2 (SPEC-2) is being built this sprint and the contact keyframe is its only pixel input.
- `keyframe_format="url"` → pin JPEG to IPFS (reuse the agents' Pinata path or add an engine-side pin helper) →
  return `imageUrl`. `"base64"` → inline `imageBase64`. Keep ≤1–3 keyframes/stroke to bound payload.
- Implement `base64` first (no infra dependency) so SPEC-2 can integrate immediately; wire `url`/IPFS pinning
  next. `emit_keyframes` still gates it per request, but the demo path runs with it **on**.

### 3.6 Input hardening (G9)
- Enforce a max download size (e.g. 200 MB) and a content-type/codec sanity check after download; fail with 422.
- Keep the 45s duration cap. Add a clear 422 when no track passes the confidence floor (already partially there).

### 3.7 Rename (G7)
- `symmetry_score` → `consistency_score` everywhere (pydantic, Zod, prompt, mock, README, analysis_notes copy).
  Keep `summary.symmetryScore` populated for back-compat during cutover.

---

## 4. Files to change

- `lib/velo-engine/src/models.py` — v2 pydantic models + camelCase alias config; `AnalyzeRequest` v2.
- `lib/velo-engine/src/yolo_analyze.py` — tracking, subject selection, handedness, per-stroke loop, confidence,
  keyframe export.
- `lib/velo-engine/src/kinematics.py` — per-stroke windowing helpers (new fns; keep existing signatures).
- `lib/velo-engine/src/analyze.py` — **do not edit** (frozen MediaPipe failsafe). If it must emit v2, add a thin
  adapter that maps its v1 output into the v2 `summary` block only.
- `lib/velo-engine/src/main.py` — pass new request fields through; `model_dump(by_alias=True)`.
- `lib/velo-agents/src/ai/schemas.ts` — mirror v2 exactly; export updated `TennisTelemetry` type.
- `lib/velo-agents/src/ai/prompts.ts` — read `aggregate` + iterate `strokes[]` (per-stroke deltas), include
  handedness + confidence; keep it LLM-readable.
- `lib/velo-agents/src/agents/form-agent.ts` — `TennisTelemetrySchema.parse()` (no cast); update `buildMockTelemetry`
  to v2; keep `summary` populated.
- `lib/velo-engine/README.md`, `.env.example`, `test_engine.py` — reflect new fields/flags.

---

## 5. Verification (acceptance gates — DO run these)

1. **Round-trip:** a recorded engine JSON response `JSON.parse` → `TennisTelemetrySchema.parse()` succeeds
   (no `as` cast). Add a fixture test in velo-agents.
2. **Contract parity test:** a script that asserts pydantic `model_json_schema()` field set == Zod field set
   (camelCase). Must pass.
3. **Subject selection:** on the in-repo coach+student clip
   `reference-files-eshaan/edg-jjwx-xwy (2026-05-30 08_59 GMT-7).mp4`, overlays must land on the **student**
   (the one swinging), not the coach. Capture overlay frames. `auto` and `largest` must be able to disagree.
4. **Per-stroke:** a multi-stroke clip yields `strokes.length > 1` with distinct windows; a single-stroke clip
   yields length 1.
5. **Handedness:** a known right-handed and a known left-handed clip resolve correctly; `handedness_hint` override works.
6. **Keyframes:** `emit_keyframes=true` returns ≥1 keyframe per stroke (base64 or URL) and frames are on-action.
7. **Live path:** boot engine, `VISION_MODE=live`, run form-agent against it (mockable Somnia/Groq) — the prompt
   built from live telemetry contains real numbers, not `undefined`.
8. Re-run the existing `SMOKE_TEST.md` table; `status=ok`, schema passes.

**Report:** PR description must state which contract decision (A/B) was taken, paste the parity-test output, and
include 4–6 overlay frames proving the student (not coach) was selected.
