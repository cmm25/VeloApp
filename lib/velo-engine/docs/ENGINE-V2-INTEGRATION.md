# Velo Engine v2 — Honesty Layer + Craig-Factory Integration

**Branch:** `feature-nn-engine-v2` (off `origin/main`). **Date:** 2026-06-04.
**Status:** implemented + tested (synthetic, mocked e2e, real-footage e2e, engine↔agent contract). **Not pushed.**

This document records what was built, the decisions behind it (including the ones
that *changed* under research evidence), and the risks that must be closed before
shipping. It is the companion to `lib/velo-training/docs/GEMINI-HANDOFF.md`.

---

## 1. What shipped

A `TennisTelemetry` **v2.1** that adds a *deterministic honesty layer* on top of the
YOLO11-pose engine, plugged into Craig's analyzer-factory seam, with the agent-side
contract migrated so the live Form Agent path keeps working.

| Area | Change |
|---|---|
| **Bug fixes** | (1) wrist-velocity scaling: `‖Δxy‖ * fps` → `* fps / Δframes` (was ~5× too high at sample_rate=5); (2) `EngineInfo.backbone` derived from the loaded weights instead of the hardcoded `"yolo11s-pose"`; (3) VFR timestamp error fixed by Pass-0 CFR normalization. |
| **Pass-0 CFR** | `video_io.ensure_cfr()` transcodes to constant-frame-rate via ffmpeg before analysis — fixes VFR `idx/fps` timestamps **and** is the on-chain determinism anchor. Falls back to the original clip if ffmpeg is absent/fails. |
| **Smoothing** | Zero-phase Butterworth (`scipy.filtfilt`, 4th-order, 8 Hz) on raw keypoints before geometry. Deterministic (no peak-time shift); self-disables when fps is too low to low-pass at 8 Hz. **Chosen over One-Euro** (causal, can't be zero-lag — wrong for a persisted/on-chain number). |
| **Kinematic sequence** | `kinematics.kinematic_sequence()` — proximal→distal evidence with a strict honesty contract (§2). Per-stroke `KineticChain`; clip-level rollups on `Aggregate`. |
| **Two-pass dense decode** | `_dense_pass()` re-decodes the CFR clip once and runs pose at full rate only inside stroke windows, re-identifying the subject by nearest bbox-center to the Pass-1 track. Lifts effective fps so the coarse hips-before-arm hand-off becomes resolvable. Gated by `DENSE_STROKE_WINDOW` (see R1). |
| **Validity gates** | `link_length_outlier_frames` (impossible **elongation** only — 2D projection can only shorten true bone length, so we flag upper-bound exceedances, never foreshortening) + `acceleration_outlier_frames` (MAD outliers). Reported in `quality.framesKeypointOutlier` (informational; does not drop frames). |
| **Scale** | Velocities normalized to torso-lengths/sec (`peakWristVelocityTlPerS`) + `velocityScaleSource` enum. Engine refuses metric scale until court homography. |
| **Integration** | New `YoloAnalyzer(VideoAnalyzer)` (owns Pass-0 + cleanup); `analyzer_base` widened with optional `request`; `factory` defaults to `yolo` (env unified on `VISION_ENGINE`, `ANALYZER_BACKEND` kept as read-fallback); **mediapipe/custom demoted** (factory raises 501); `main.py` rebuilt on the factory + v2 by-alias serialization. |
| **Contract** | `schemas.ts` gains optional v2 fields; `form-agent.normalizeTelemetry` now reads the v2 `summary` block (was validating a flat schema that v2 no longer matches — the live path was broken) and grafts the honesty signals; `prompts.ts` surfaces speed-gain + sequence with explicit measurement caveats. Legacy flat v1/mock payloads still validate (back-compat). |

---

## 2. The honesty contract (the actual differentiator)

Grounded in the biomech literature (Putnam 1993; Bullock 2021 — even 360 Hz Vicon
could not resolve adjacent-segment peak order; tennis-serve IMU PMC11746891 — pelvis↔trunk
lag ≈28 ms, sign-inverted even in elite athletes; intersegmental *timing* did **not**
correlate with ball speed, but peak *angular velocity* did):

1. **Speed-gain is PRIMARY, ordering is SECONDARY-and-gated.** `proximalToDistalGain`
   (did peak speed rise hips→trunk→arm) is always emitted. Peak-velocity *ordering*
   is only claimed when `timingResolvable` (frame interval ≤ ~83 ms ⇒ ≥~12 effective
   fps), and even then only as the coarse trunk→arm "hips-before-arm" hand-off (~125 ms
   ≈ 4 frames). Adjacent-segment millisecond lags are **never** reported.
2. **No sub-frame timing.** `timingGranularityMs` is emitted; anything finer is
   `timingResolvable=false` / `null`.
3. **No metric speed.** TL/s only; `velocityScaleSource` must be `court_homography`
   before any mph/m·s — which we do not have. "Wrong mph is worse than no mph."
4. **Proxy/semantic flags carried in the schema:** `wristIsProxy` (forearm orientation,
   not wrist flexion), consistency = temporal repeatability (not symmetry), velocities
   relative-within-clip. The Q-LLM prompt enforces these as hard caveats.
5. **Determinism:** every number is fixed-parameter NumPy/SciPy (filtfilt + find_peaks
   with pinned coefficients) + a byte-stable CFR input → reproducible for on-chain.

---

## 3. Decisions that changed under research

- **One-Euro → zero-phase Butterworth.** Gemini recommended One-Euro; the literature
  says a causal filter is wrong for a persisted/on-chain number. We use `filtfilt`.
- **Order/Kendall-τ → speed-gain primary.** Gemini's order-based metric isn't defensible
  at 30 fps. We lead with magnitude/gain and gate ordering. (`sequenceCoherenceScore`
  remains as a coarse ordinal, gated.)
- **Single-pass "densify the slice" → two-pass re-decode + Pass-0 CFR.** The slice is
  found *after* decode, and `cv2` frame-seek is unreliable on phone VFR; CFR + a
  monotonic decode counter is the only index-aligned way.

---

## 4. Risk register (close before shipping)

| # | Risk | Status | Action |
|---|---|---|---|
| **R1** | **Koyeb CPU latency / dense-pass cost.** Local (fast Apple Silicon) bench: yolo11s ≈80 ms/frame, yolo11l ≈221 ms/frame; a real ~10 s clip with dense pass over 5 strokes took **55 s wall**. A 45 s clip — and Koyeb's 2–3× slower per-core CPU — will blow the ~60 s budget, especially with `DENSE_STROKE_WINDOW=1`. | **OPEN — highest priority** | Benchmark on the actual Koyeb instance. Likely ship with `DENSE_STROKE_WINDOW=0` (coarse speed-gain still works; timing just stays unresolved) and/or cap the dense pass to the single best stroke; reconsider yolo11l-global vs yolo11s. |
| R2 | yolo11l +29% gain measured on **broadcast** hardval only | OPEN | Validate against a phone-clip hardval before shipping the swap. |
| R3 | `scipy==1.13.1` vs `numpy==1.26.4` pin | LOW | Compatible; verify in the slim image build. |
| R4 | ffmpeg in container | CLOSED | Dockerfile already installs ffmpeg; `ensure_cfr` falls back if absent. |
| R5 | weights shipping | CLOSED | Dockerfile pre-bakes `yolo11s-pose.pt`. |
| R6 | validity gate over-flags on broadcast pans | LOW | `framesKeypointOutlier` is informational only (doesn't drop frames); tune thresholds for phone clips later. |
| R7 | dense-pass subject re-match | MEDIUM | Nearest-bbox-center to Pass-1 track; robust when the subject is the dominant mover. Revisit for crowded frames. |

---

## 5. Test evidence

- Synthetic textbook chain → `gain=1.0, hipsBeforeArm=True, coherence=1.0`.
- Mocked e2e: coarse (≈5 fps) refuses timing (`timingResolvable=false`, speed-gain only);
  dense (CFR) unlocks `hipsBeforeArm=true` at 42 ms granularity.
- Real ffmpeg CFR + cleanup verified (no temp leak).
- Engine→agent contract: real v2 payload validates through `normalizeTelemetry`+Zod; v1/mock still validates.
- **Real footage** (GVHMR `tennis.mp4`, VFR): CFR-normalized, meanKpConf 0.97, 5 strokes,
  stroke0 forehand `gain=1.0 hipsBeforeArm=True` @33 ms, schema-valid v2.

---

## 5b. Post-review hardening (adversarial pass, 9 confirmed fixes)

A multi-agent adversarial review (find → independently verify) ran over the diff;
all 9 confirmed findings were fixed and re-tested:

- **C1 (crash):** `_FILTFILT_MIN_LEN` was 13 but `filtfilt` needs ≥16 (padlen=3·(order+1)); 13–15-frame windows crashed the *unguarded* main-path smoothing. Fixed (derive from `BUTTER_ORDER`) + fail-soft explicit `padlen`.
- **C2 (live break):** `bounty-agent.ts` had a *second*, stale v1 `normalizeTelemetry` (only `form-agent` was fixed) — every real v2 response would fail validation. Extracted a single shared `ai/normalize-telemetry.ts` now used by both.
- **H3:** dense-pass dropped-detection gaps were treated as single-frame steps → inflated speeds. Now stores source frame index and only emits a dense window if it's a contiguous run (else coarse fallback).
- **H4:** `sequence_coherence_score` counted ties as concordant (`<=`) → spurious 1.0 for a frozen subject. Now real Kendall-τ (ties neutral; all-tied ⇒ `None`).
- **H5:** `download_video` leaked its temp file on every validation-error raise. Wrapped in `try/except BaseException` with unlink.
- **H6:** `lifespan` swallowed warmup failures and `/healthz` still said "ok". Now re-raises misconfig (fail-fast) and `/healthz` returns 503-degraded on transient warmup error.
- **M7:** per-stroke `peakWristVelocityPx` (coarse) and `kineticChain.armPeak` (dense) disagreed; both now sourced from the dense pass when present.
- **M8:** `ensure_cfr` re-encoded (up to 600s) on any failure; now only falls back to the legacy flag on an unsupported-option error.
- **L9:** dense-pass subject re-ID now biased toward continuity with the previous pick (crossing-player robustness).

## 6. Open / next

- Close R1 (Koyeb benchmark) — gates the dense pass and the yolo11l swap.
- Build the ~100–300 frame phone-clip hardval + synthetic-degradation eval harness.
- Surface `kineticChain` per-stroke detail to the prescription LLM (currently form-only).
- velo19 racket head (post-MVP, gated on ball + scale) — single bolt-on `[19,3]` head leaning.
- Migrate Zod fully to the v2 nested shape (currently flattens `summary`) once stable.
