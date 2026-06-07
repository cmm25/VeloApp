# Velo Vision Engine — Integration Guide

**For the agent-runner integration (Craig).** This is the single doc you need to wire the engine into the runner. It covers what the service is, how it ingests video, the request, and the **full output JSON schema with every field explained**.

---

## 0. TL;DR

- It's an **HTTP service**. You `POST` a **video URL**; you get **tennis telemetry JSON** back.
- **Live:** `https://velo-engine-theportal-3b21b963.koyeb.app`
- **Wire-up:** set `VISION_ENGINE_URL=https://velo-engine-theportal-3b21b963.koyeb.app` and `VISION_MODE=live` on the runner. The runner's existing `normalizeTelemetry()` (`lib/velo-agents/src/ai/normalize-telemetry.ts`) **already consumes this exact shape** — no adapter needed.
- Body-pose only today (racket keypoints deferred → `racketKeypoints:false`).
- Deterministic on this box (amd64). The `telemetryHash` is the on-chain commitment (see §7).

---

## 1. What it is

A deterministic tennis pose-analysis sidecar: **YOLO11-pose** (17 COCO body keypoints) + **BoT-SORT** tracking + **NumPy kinematics** → a nested `TennisTelemetry v2.1` JSON. It does **not** call an LLM — it produces measured numbers; your agents do the coaching reasoning on top.

---

## 2. How it ingests video — **video in, not frames**

You pass **one video** (a URL or IPFS gateway URL). The engine does all frame handling internally:

```
your videoUrl/CID
  → download           (≤200MB; must be a decodable video; content-type video/* or octet-stream)
  → CFR normalize      ffmpeg → constant 30fps, single-thread/bitexact  (fixes phone VFR; determinism anchor)
  → decode + SAMPLE     keep every Nth frame  (sampleRate, default 5)
  → YOLO11-pose + track 17 body keypoints + a stable trackId per player
  → NumPy kinematics    joint angles, wrist velocity, kinetic chain
  → TennisTelemetry JSON + telemetryHash
```

**You never split or stream frames** — just hand it a video URL. (IPFS CIDs: resolve to a gateway URL before sending, or pass it as `videoUrl`; `videoCid` is recorded for provenance.)

---

## 3. Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Liveness. `{"status":"ok","version":"2.1.0","engine":"yolo"}`. Returns **503** `{"status":"degraded",...}` if model warmup failed. |
| `POST` | `/analyze` | Analyze a clip → `TennisTelemetry`. |

**Quick test:**
```bash
curl -s https://velo-engine-theportal-3b21b963.koyeb.app/healthz

curl -s -X POST https://velo-engine-theportal-3b21b963.koyeb.app/analyze \
  -H 'content-type: application/json' \
  -d '{"videoUrl":"https://.../clip.mp4","videoCid":"Qm...","maxDurationS":45,"sampleRate":5}'
```

---

## 4. Request schema (`AnalyzeRequest`)

JSON body, **camelCase** (snake_case also accepted). Agents only ever need to send `videoUrl` + `videoCid`; everything else has sane defaults.

| Field | Type | Default | Notes |
|---|---|---|---|
| `videoUrl` | string (**required**) | — | IPFS gateway URL or direct video URL. |
| `videoCid` | string\|null | null | Original IPFS CID, echoed back for provenance. |
| `maxDurationS` | number | `45` | Analyze at most this many seconds (`>0`, `≤120`). Caps cost. |
| `sampleRate` | int | `5` | Analyze every Nth frame (`1`–`60`). 5 ⇒ ~6 fps on 30fps video. |
| `subject` | object | `{strategy:"auto"}` | Which player to analyze (see below). |
| `subject.strategy` | enum | `auto` | `auto`\|`most_active`\|`largest`\|`center`\|`roi`\|`track_id`. |
| `subject.handednessHint` | enum\|null | null | `right`\|`left` to override auto handedness. |
| `subject.roiBbox` | [x,y,w,h]\|null | null | Required if `strategy="roi"` (normalized 0–1). |
| `subject.trackId` | int\|null | null | Required if `strategy="track_id"`. |
| `emitKeyframes` | bool | false | Attach keyframe images per stroke phase. |
| `keyframeFormat` | enum | `url` | `url`\|`base64`\|`none`. |
| `emitRawKeypoints` | bool | false | (Reserved.) |

---

## 5. Response schema — `TennisTelemetry v2.1` (full field reference)

Top-level object:

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | `"2.1"` | Contract version. |
| `isMock` | bool | `false` for real inference. `true` only on the runner's mock path — **a mock must never be treated as a real on-chain commitment.** |
| `telemetryHash` | string | `"sha256:<64hex>"` over the canonical numeric telemetry. **The deterministic on-chain commitment** (see §7). |
| `engine` | object | Model + provenance (see 5.1). |
| `video` | object | Source clip facts (see 5.2). |
| `subject` | object | Which player was analyzed (see 5.3). |
| `keypointSpec` | object | Keypoint naming/indexing (see 5.4). |
| `strokes` | array | Per-stroke telemetry (see 5.5). **The core payload.** |
| `aggregate` | object | Clip-level rollups (see 5.6). |
| `quality` | object | Frame-quality diagnostics (see 5.7). |
| `analysisNotes` | string\|null | Human-readable one-line summary of the run. |
| `summary` | object | **Flattened** view the form-agent reads directly (see 5.8). |

### 5.1 `engine`
| Field | Type | Meaning |
|---|---|---|
| `backbone` | string | Resolved pose model, e.g. `yolo11s-pose`. |
| `weights` | string | Weights file, e.g. `yolo11s-pose.pt`. |
| `kpConfMin` | 0–1 | Keypoint confidence floor used. |
| `sampleRate` | int | Frame sampling used. |
| `coco17` | bool | `true` — 17 COCO body keypoints. |
| `racketKeypoints` | bool | `false` today (racket model not fused yet). |
| `velocityScaleSource` | enum | **How velocities are scaled.** `torso_length` ⇒ velocities are in **torso-lengths/sec (relative, NOT mph)**. Only `court_homography` would permit metric units (not in production). |
| `timingGranularityMs` | number | ms between analyzed frames (`1000/effective_fps`). Timing finer than this is unresolved. |
| `smoothing` | string\|null | Keypoint smoothing provenance (deterministic). |
| `normalizedCfr` | bool\|null | `true` if the clip was transcoded to constant-frame-rate first. |
| `weightsSha256` | string | SHA-256 of the loaded weights — pins **which** model produced this. |
| `libVersions` | object | Pinned `{torch, ultralytics, numpy, scipy, cv2}` the hash reproduces against. |

### 5.2 `video`
`url`, `cid`, `durationMs`, `fps`, `width`, `height`, `framesTotal`, `framesAnalyzed`, `frameStreamSha256` (SHA-256 of the decoded frame stream — the I/O determinism anchor, present on the canonical path).

### 5.3 `subject`
`selectionStrategy`, `trackId`, `handedness` (`right`/`left`), `handednessSource` (`auto`/`hint`), `bboxMeanNorm` ([x,y,w,h], normalized 0–1), `meanKeypointConfidence` (0–1), `framesPresent`.

### 5.4 `keypointSpec`
`names` (ordered keypoint names), `coordinateSystem` = `"normalized"` (0–1), `indexing` = `"coco17"` (becomes `"velo19"` only once racket keypoints ship).

### 5.5 `strokes[]` — one per detected stroke
| Field | Type | Meaning |
|---|---|---|
| `index` | int | Stroke ordinal. |
| `type` | enum | `forehand`\|`backhand`\|`serve`\|`volley`\|`unknown`. |
| `typeConfidence` | 0–1 | Confidence in the stroke type. |
| `startMs`/`endMs`/`startFrame`/`endFrame` | number/int | Stroke window. |
| `phases` | object | `preparation` / `contact` / `followThrough`, each a **PhaseSample**: `frameIndex`, `timestampMs`, `angles` (JointAngles), `angleConfidence` (0–1). |
| `peakWristVelocityPx` | number | Peak wrist speed in **px/sec** (resolution-dependent; within-clip only). |
| `peakWristVelocityTlPerS` | number\|null | Peak wrist speed in **torso-lengths/sec** (scale-comparable across clips). |
| `kineticChain` | object | Proximal→distal sequence evidence (see below). |
| `keyframes` | array | Empty unless `emitKeyframes:true`. |

**`JointAngles`** (degrees): `shoulder`, `elbow`, `wrist`, `hip`, `knee`, plus `wristIsProxy` (bool — `true` means the "wrist" angle is a **forearm-orientation proxy**, not true wrist; will become true wrist once racket ships) and `racketFaceDeg` (null today).

**`kineticChain`** (honesty-gated — read the flags before claiming anything):
| Field | Type | Meaning |
|---|---|---|
| `pelvisPeakTlPerS` / `trunkPeakTlPerS` / `armPeakTlPerS` | number\|null | Segment peak speeds (torso-lengths/sec). |
| `proximalToDistalGain` | 0–1 | **PRIMARY, ball-speed-correlated signal.** Fraction of proximal→distal steps where peak speed increases (1.0 = textbook chain). |
| `hipsBeforeArm` | bool\|null | Coarse gross timing; set **only** when `timingResolvable`. |
| `sequenceCoherenceScore` | 0–1\|null | Coarse peak-order agreement; only when `timingResolvable`. |
| `timingResolvable` | bool | **`false` ⇒ do NOT make millisecond timing claims** (30fps can't resolve ~20–50ms ordering). Use `proximalToDistalGain` instead. |
| `timingGranularityMs` | number\|null | Effective ms between frames in this window. |
| `notes` | string\|null | e.g. "timing UNRESOLVED at ~167ms; speed-gain only". |

### 5.6 `aggregate`
`peakAngles`, `avgAngles` (JointAngles), `consistencyScore` (0–1, temporal repeatability — **not** left/right symmetry), `dominantStroke`, `strokeCount`, `kinematicSequenceValid` (bool\|null), `sequenceCoherenceScore` (0–1\|null), `peakProximalToDistalGain` (0–1\|null, the best chain score across strokes — the headline sequence signal).

### 5.7 `quality`
`framesSkippedLowConf`, `framesNoPerson`, `framesMultiPersonAmbiguous`, `occlusionRatio` (0–1), `meanKeypointConfidence` (0–1), `framesKeypointOutlier` (failed the validity gate), `clipQualityOk` (bool — overall deterministic clip-quality gate).

### 5.8 `summary` (flattened — what the form-agent reads)
`videoUrl`, `durationMs`, `framesAnalyzed`, `fps`, `strokePhases[]` (flat list of phase samples), `peakAngles`, `avgAngles`, `symmetryScore` (**deprecated alias** for `aggregate.consistencyScore`), `dominantStroke`, `strokeCount`, `analysisNotes`.

> The runner's `normalizeTelemetry()` reads `summary.*` and grafts the honesty signals from `engine`/`aggregate` (+ `telemetryHash`). You don't have to parse the nested tree yourself unless you want the per-stroke detail.

---

## 6. The honesty contract (so coaching claims stay defensible)

- **Velocities are relative**, not mph: `velocityScaleSource:"torso_length"` ⇒ report torso-lengths/sec, never metric speed.
- **`wristIsProxy:true`** ⇒ the wrist angle is a forearm proxy.
- **`timingResolvable:false`** ⇒ no "hips fired X ms before arm" claims; lead with `proximalToDistalGain`.
- **`isMock:true`** ⇒ synthetic data; not a real measurement or on-chain commitment.

These already flow into the form-agent's prompt via `normalizeTelemetry` — keep them visible in any coaching copy.

---

## 7. Determinism & on-chain (what to commit)

- `telemetryHash` = `sha256` over the canonical, rounded numeric telemetry. **Byte-identical for the same clip on the same pinned arch/image.** Proven on this Koyeb box: two identical runs → same hash.
- **Cross-arch caveat:** the hash is reproducible on **this amd64 deployment**, *not* on an arbitrary CPU (a dev laptop produces a different hash). **So the canonical/reference hash must always be generated from this Koyeb box.**
- **On-chain commitment (already wired, no contract change):** the form receipt pins `reportPayload` (which now includes `telemetry` **with** `telemetryHash`) to IPFS and sets `summaryHash = keccak256(reportPayload)`. So the on-chain receipt commits the deterministic hash transitively. To audit: fetch the IPFS doc by `ipfsCid` → read `telemetryHash` → re-run this engine on the same clip → confirm match. (This is the R2 fix on `feature-nn-engine-v2`.)

---

## 8. Errors

| Status | When |
|---|---|
| `400` | `videoUrl` missing. |
| `422` | Bad input / undecodable or invalid video. |
| `501` | Backend demoted (only `yolo` is supported; mediapipe/custom are off). |
| `500` | Analysis error. |
| `503` (on `/healthz`) | Model warmup failed; orchestrator should retry/alert. |

The engine **never fabricates** output — it errors loudly instead.

---

## 9. Operational facts (current deployment)

- **URL:** `https://velo-engine-theportal-3b21b963.koyeb.app`
- **Instance:** Koyeb `eco-large` (2 vCPU / 4 GB), region `was`, always-on (no cold start).
- **Config:** `VISION_ENGINE=yolo`, `YOLO_WEIGHTS=yolo11s-pose.pt`, `DENSE_STROKE_WINDOW=0` (coarse, for latency headroom).
- **Latency:** ~14–16 s for a 10 s clip; a full 45 s clip ≈ 60–70 s — **under the runner's 120 s analyze timeout.** (Engine is single-threaded by design for determinism; per-clip speed is CPU-bound, not core-count-bound.)
- **Rebuilds** automatically on push to `feature-nn-engine-v2` (Koyeb git-docker build from `lib/velo-engine/Dockerfile`).

---

## 10. Your next steps (integration checklist)

1. Set `VISION_ENGINE_URL` + `VISION_MODE=live` on the runner.
2. Confirm `normalizeTelemetry` validates a live `/analyze` response (it already supports v2.1 + the `telemetryHash` field).
3. Run one job end-to-end with your funded wallet → confirm the on-chain receipt's `ipfsCid` resolves to a report containing `telemetryHash`.
4. (Optional) Generate the **canonical reference hash from this Koyeb box** for the determinism audit story.

Body-pose telemetry is live and deterministic. Racket keypoints, the yolo11l precision swap, and phone-clip validation are deferred follow-ups (all unblocked now that we have Koyeb Pro).
