# Velo — Determinism Problem Handoff (for Gemini: heavy math + simulations)

**Purpose.** We need you (Gemini) to do the quantitative heavy lifting on one question: *can the Velo v2 pose→biomechanics pipeline be made deterministic enough for an on-chain audit, and if so, with what exact rounding/quantization scheme?* Run real simulations (you have code execution), give us numbers and a recommended spec. We will implement from your answer.

Do **not** restate our thesis back to us or write a framework comparison. We want error-propagation math, Monte-Carlo results, and a concrete rounding grid with justification.

---

## 1. What Velo is (1 paragraph)

Open-source tennis coaching. One phone clip → `TennisTelemetry` JSON (per-stroke joint angles, stroke phases, a proximal→distal kinematic-sequence summary, quality flags) → a quarantined vision-LLM + deterministic checkpoint → a coaching report whose verdict is committed **on-chain** for auditability. Core thesis: *"convert pixels to symbols first — never ask an LLM to do geometry."* The NN only localizes joints; every biomechanical number is plain NumPy/SciPy.

## 2. The pipeline (where determinism must hold)

```
video → [Pass-0 ffmpeg CFR transcode] → cv2 decode →
        [YOLO11-pose inference, torch CPU] → 17 COCO keypoints/frame (float px) →
        [deterministic NumPy/SciPy geometry] → TennisTelemetry JSON →
        round? hash? → on-chain commitment
```

The on-chain requirement: the verdict must be a **code-computed scalar**, reproducible — not an LLM token. "Auditable" should mean: re-run the canonical pipeline on the same input → same committed value.

## 3. The determinism audit (current honest state)

**Deterministic today** (fixed-coefficient, no RNG, same input array → same output, given pinned lib versions):
- All geometry: `angle_between` (= `degrees(acos(clip(dot(BA,BC)/(|BA||BC|),-1,1)))`), zero-phase Butterworth `scipy.filtfilt` (order 4, 8 Hz), `scipy.signal.find_peaks`, the kinematic-sequence logic, validity gates, subject selection, stroke segmentation.

**NOT deterministic / not pinned (the holes):**
1. **YOLO/torch CPU inference floats.** No seed, no `torch.set_num_threads(1)`, no `torch.use_deterministic_algorithms(True)`. Runs multithreaded (measured 624% CPU). Parallel float-reduction order varies → keypoint coords differ at some ULP scale within a machine, and differ **more** across machines (different BLAS/torch build/CPU μarch: Mac dev vs Koyeb prod).
2. **`model.track`** uses a stateful tracker (BoT-SORT + Kalman); order/timing dependent. (Dense pass uses `model.predict`.)
3. **ffmpeg CFR transcode** (`-fps_mode cfr -r 30 -c:v libx264 -preset veryfast`): x264 output not bit-identical across versions/threads/platform; then cv2 decode pixel values vary.
4. **No rounding** of NN floats before they enter `acos`/peak-detection. Tiny input drift can amplify (esp. `acos` near ±1, and `argmax`/`find_peaks` near ties).
5. **No content hash, no version/weights pinning** implemented. The "CFR = determinism anchor" line in our docs is aspirational, not coded.

**Our working hypothesis (please validate or break it):** true cross-hardware bit-determinism for NN float inference is impossible, so the correct boundary is: (a) pin the runtime (versions, weights SHA, single thread, deterministic flags, seed) so a *given container* is reproducible, and (b) **round every telemetry number to a fixed grid before hashing**, so that residual float drift below the grid never changes the committed hash. On-chain stores `hash(rounded_telemetry)` + the scalar verdict, never raw floats. Reproducibility = "same pinned image + same input → same hash," not "any machine matches."

## 4. What we need from you — heavy math + simulations

Give numbers, not prose. You can run Python (numpy/scipy available conceptually). Use realistic ranges below.

**Telemetry fields + units/ranges** (the things we'd round & hash):
- joint angles: degrees, 0–180.
- `*_tl_per_s` velocities (torso-length/sec): ~0–15, monocular (noisy; literature r≈0.1–0.5 vs ground truth).
- timestamps: ms, multiples of frame interval (33.3 ms @30fps after CFR).
- `proximalToDistalGain`: {0, 0.5, 1.0}. `sequenceCoherenceScore`: small ordinal set. `hipsBeforeArm`: bool.
- keypoints: pixel coords in ~720–1080p frames.

**Q1 — Error propagation, keypoint→angle.** Derive (analytically) the sensitivity of `angle_between(A,B,C)` to a perturbation ε in each of the 6 keypoint coordinates. Where does it blow up (short segments |BA|→0, near-collinear, near-straight 180°)? Then Monte-Carlo: for keypoint noise σ ∈ {0.01, 0.1, 0.5, 1.0, 2.0} px on segments of length L ∈ {20, 50, 100, 200} px, give the resulting angle-error distribution (mean, p95, max) in degrees. Conclusion: what input-coordinate precision bounds angle error below, say, 0.1°?

**Q2 — Float nondeterminism magnitude (model it).** You can't run YOLO, but model the realistic drift in keypoint coordinates from (a) thread-count change in a parallel reduction, (b) different BLAS/CPU. Estimate the ULP/relative magnitude for float32 accumulation over typical conv/matmul sizes, and translate to expected px drift in keypoint outputs. Is it ~1e-4 px, ~1e-2 px, ~1 px? Cite the reasoning. Feed that drift into Q1 to get the downstream angle-error it causes.

**Q3 — Rounding/quantization grid.** Find the grid per field type that (i) is coarser than the expected float drift from Q2 (so the hash is stable) but (ii) finer than the biomechanically meaningful resolution (so we don't destroy signal). Sweep candidate grids (e.g. angles to 0.1° / 0.5° / 1°; velocities to 1e-2 / 1e-1 TL/s; timestamps to 1 ms / 1 frame). For each, report: probability two drift-perturbed runs hash identically, and the signal loss. Recommend the grid.

**Q4 — Discrete-decision stability.** `find_peaks`/`argmax` for peak-velocity frame, stroke-window boundaries, subject selection, and `hipsBeforeArm` are *discrete* outputs — a tiny float drift can flip them across a threshold, and rounding the *output* doesn't help if the *decision* flipped upstream. Quantify: near a near-tie, what's the probability a peak index or a boolean flips under Q2-scale drift? Propose how to make discrete decisions robust (hysteresis / dead-band / tie-break rules / rounding *inputs* before deciding).

**Q5 — The honest verdict.** Given Q1–Q4: is "pin-the-container + round-then-hash" sufficient for a credible on-chain audit, or is there a residual non-determinism (e.g. the discrete flips, or ffmpeg/decode pixel drift) that rounding can't absorb? If the latter, what's the minimal architecture change — e.g. round keypoints *before* geometry, or hash decoded-frame content instead of the transcoded file, or commit a tolerance band instead of an exact hash? Give the decision rule.

**Q6 — ffmpeg/decode.** Is the CFR transcode worth keeping in the determinism path, or should the canonical run hash the *decoded keypoint stream* (post-inference) rather than rely on byte-identical video? Weigh: VFR timestamp correctness (why we added CFR) vs transcode non-determinism.

## 5. Constraints (hard)
- CPU-only, Koyeb free tier, ~1 min/clip batch. No GPU.
- numpy pinned `==1.26.4` (ultralytics 8.3.40 `np.trapz`); scipy `==1.13.1`.
- On-chain verdict must be deterministic scalar; no stochastic post-processing, no test-time training, no MLLM-gated loops in the inference path.
- Monocular 2D: angles transfer ~r0.8–0.9, velocities ~r0.1–0.5 (so velocity precision matters less than angle precision — factor this into the grid).
- Honesty rule: we publish what we cannot guarantee. A "reproducible only within the pinned container" claim is acceptable **if stated**; a false "bit-identical anywhere" claim is not.

## 6. Output we want back
1. The angle-error propagation result (analytic + MC table).
2. Estimated float-drift magnitude (px) and the angle error it induces.
3. A **recommended rounding grid per field** with the stable-hash probability and signal-loss numbers.
4. The discrete-decision robustness rule.
5. A yes/no on "pin + round-then-hash is sufficient," with the minimal fix if no.
6. Whether to keep ffmpeg in the determinism path.

Repo specifics if useful (you don't have the repo, this is context): geometry in `lib/velo-engine/src/kinematics.py`, engine in `yolo_analyze.py`, schema in `models.py`, full design + risk register in `lib/velo-engine/docs/ENGINE-V2-INTEGRATION.md`.

---

### Suggested skills (for the Claude Code agent that resumes after Gemini replies)
- `caveman` — user preference, keep terse.
- Implement Gemini's grid in `kinematics.py`/`models.py` (round-before-hash + round-inputs-before-discrete-decisions), pin runtime in `Dockerfile`/startup (`torch.set_num_threads(1)`, `use_deterministic_algorithms(True)`, seed, weights SHA), add a self-test "same input ×2 → same hash."
- `code-review` (high) on the determinism change before commit.
