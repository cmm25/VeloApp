# Velo NN — Master Log, Decisions & Roadmap

**Canonical reference for the pose/NN/determinism effort.** Self-contained so a
zero-context agent can resume. Last updated 2026-06-05.

> Companion docs (do not duplicate — read these too):
> - `lib/velo-engine/docs/ENGINE-V2-INTEGRATION.md` — what v2 shipped + risk register.
> - `docs/GEMINI-DETERMINISM-HANDOFF.md` — the determinism problem statement sent to Gemini.
> - `lib/velo-training/docs/ITERATION-LOG.md` — finetune experiments + stock zoo.
> - `lib/velo-training/CODEX-START-HERE.md` — training runbook + guardrails.
> - `lib/velo-engine/docs/CODEX-SPEC-3-finetune-autoannotation.md` — pose/data spec.

---

## 0. CURRENT DECISION (the plan we're executing)

**"A then B": get determinism solid for free, then spend Modal credit on the one NN bet that isn't already dead.**

- **Phase 1 (DONE 2026-06-05, $0):** deterministic workflow IMPLEMENTED + PROVEN. `telemetryHash` is byte-identical across fresh processes AND `OMP_NUM_THREADS=1` vs `=8` (self-test `lib/velo-engine/test_determinism.py` green). Measured same-arch keypoint drift = 0px; the engine is pinned single-thread + seeded + deterministic-algorithms; keypoints rounded before geometry; canonical sorted/rounded JSON hash over the numeric telemetry (volatile fields dropped) + provenance (weights SHA, lib versions, optional frame-stream SHA). Honest scope: reproducible on the SAME pinned arch/image, not across arbitrary CPUs. Implements the 14-root-cause audit worklist (R1–R14). See §3.
- **Phase 2 (Modal credit, with a spend cap + kill switch + scheduled-agent monitoring):** **velo19 racket-keypoint head** — the only genuinely-custom NN bet. Requires downloading RacketVision first.
- **Explicitly skipped:** body-pose finetuning (already lost — see §3), RunPod ($3 ≈ 1 run, too little), phone-clip hardval (labeling job, later), top-down/ball/court (later).

Branch: **`feature-nn-engine-v2`** (commit `2077883e`, off `origin/main`, **not pushed**). Safety snapshot of raw v2 work on `feature-nn` (`37434ec4`). User prefers **caveman** comms.

---

## 1. How we got here (session arc, 2026-06-04→05)

1. User shared a 2-round consult with **Gemini** on NN direction. We critiqued it against the actual code.
2. Ran a **research workflow** (Craig's integration seam + telemetry contract + engine internals + external validation of seek/kinetic-chain/One-Euro). Findings flipped 3 of Gemini's calls (see §2).
3. **Built engine v2.1** (honesty layer + Craig-factory integration + agent contract migration). Tested 6 ways incl. real tennis footage.
4. **Adversarial review** found 9 confirmed bugs → all fixed & re-verified.
5. User challenged the **determinism** claim (rightly — it was overstated). We audited, then sent the quantitative problem to **Gemini**; Gemini returned error-propagation math + a rounding spec (§3).
6. **Inventory** of math/data/models/infra (§4) → confirmed body finetune is dead → chose A-then-B.

---

## 2. Settled decisions (with rationale)

| Decision | Why |
|---|---|
| **Body-pose finetuning = DEAD. Do not re-run.** | hardval mAP50-95 regressed every time: stock **0.466** → A1 **0.396** → C1 **0.379**. Bottleneck is hard training *data* (pseudo-label paradox → 22 usable frames), not compute. Model SIZE is the lever (yolo11l = 0.602 for $0). |
| Zero-phase Butterworth (`scipy.filtfilt`), **not** One-Euro | One-Euro is causal → can't be zero-lag → wrong for a persisted/on-chain number. filtfilt = no peak-time shift + deterministic. |
| Kinematic sequence: **speed-GAIN primary, ordering gated** | Biomech literature (Putnam'93, Bullock'21, tennis-serve IMU): even 360 Hz labs can't resolve adjacent-segment peak order; pelvis↔trunk lag ≈28 ms (sub-frame). Peak *magnitude/gain* correlates with ball speed; *timing* does not. So: emit gain always, "hips-before-arm" only when resolvable, never sub-frame lags. |
| v2 nested telemetry wins; **Craig's factory pattern** as skeleton; mediapipe/custom demoted to 501 | v2 is the going-forward contract; the agent already targets it. Rebuilt `main.py` on v2 + by-alias. |
| **Honesty contract = the differentiator** | Every number carries its epistemic limit: `wristIsProxy`, `velocityScaleSource` (refuses mph), `timingResolvable`, consistency≠symmetry. The unowned OSS lane = auditable phone-clip biomechanics. |
| TL/s velocity normalization (torso length), never metric | No court homography yet → "wrong mph worse than no mph". Monocular velocity is weak (r≈0.1–0.5); angles transfer well (r≈0.8–0.9) → trust angles. |

---

## 3. Determinism — the real answer (Gemini math + our corrections)

**The honest state before this analysis:** geometry layer (numpy/scipy, fixed coeffs, no RNG) IS deterministic; **YOLO/torch floats, the tracker, ffmpeg transcode, and the lack of pinning/rounding/hashing are NOT.** Our earlier "CFR = determinism anchor" claim was aspirational, not coded.

**Gemini's quantitative results (validated by us):**
- **Angle sensitivity** `‖∇θ‖ = 1/L` (L = segment length). Blows up on short segments + near 0°/180°. Monte-Carlo: at σ=1px keypoint noise, L=20px → ~3.5° mean angle error; L=200px → ~0.35°. To bound angle error <0.1° at the worst-case L=20px needs keypoint precision **<0.012 px**.
- **Float32 drift estimate** ~1e-3 to 1e-2 px within-machine (parallel-reduction order). **Our correction: cross-arch (Mac ARM vs Koyeb x86) is likely WORSE** (different conv algos/BLAS/transcendentals) — possibly 0.1–1px. Unmeasured.
- **Recommended rounding grid:** angles **1.0°**, velocities **0.1 TL/s**, timestamps **integer frame index** (1ms is false precision at 30fps).
- **Discrete-decision flips** (peak frame, stroke bounds, `hipsBeforeArm`) cascade — rounding the *final JSON* is useless if an upstream `argmax` flipped. Fix: dead-band + deterministic tie-break (min index) + round the proxy *before* the `if`.

**Gemini's key recommendation — round keypoints BEFORE geometry** (quantize kpts right after YOLO; feed only quantized kpts to `kinematics.py`; identical inputs → bit-identical numpy output across arch).

**Our critical correction (Gemini self-contradicted here):** rounding does **not eliminate** cross-hardware nondeterminism — it **moves** the boundary-flip to the keypoint-quantization grid. Straddle fraction = `2·drift/grid`. With drift 0.01px, grid 0.1px → ~20% of keypoints sit near a boundary and round differently across machines → cascade. Making it negligible needs grid ≫ drift, which costs accuracy.

**Therefore the honest determinism architecture (what Phase 1 builds):**
1. **Round keypoints before geometry** (grid `G` px — size from a *measured* drift number, default 0.1px until measured). Necessary, makes the geometry layer reproducible given fixed kpts.
2. **Pin ONE canonical environment:** `torch.set_num_threads(1)` (≈FREE — bench showed threads barely help, 221ms vs 213ms), `torch.use_deterministic_algorithms(True)`, global seed, pinned lib versions + weights SHA256. Reproducible **within the pinned image**, not across arbitrary hardware.
3. **Discrete decisions:** round-inputs-before-deciding + dead-band + min-index tie-break.
4. **Drop ffmpeg CFR from the hash path; hash the quantized keypoint stream**, not video bytes. (But Gemini's `idx/avg_fps` timing is WRONG for VFR — use real per-frame PTS from PyAV instead, no transcode.)
5. **On-chain commitment = `hash(rounded telemetry)` computed in the pinned canonical container, OR just the coarse scalar verdict** (robust to ±2° wobble). Floats never on chain. "Auditable" = re-run the pinned image on the same input → same hash. State this honestly; do NOT claim bit-identical-anywhere.
6. **Self-test:** same input ×2 → identical hash (and ideally on 2 arches once available).

**Still missing = the one empirical number:** measured keypoint drift (run YOLO ×2, diff threads/arch). Sizes the grid `G`. Deferred by user; do before finalizing `G`.

---

## 4. Inventory — Have ✓ / Gap ✗ (as of 2026-06-05)

| Piece | Status |
|---|---|
| Determinism math | ✓ (§3). Gap: measured drift number. |
| Biomech math | ✓ `kinematics.py` + research. |
| Data — body pose | ✓ `data/merged` = 2008 COCO-17 labeled imgs; `hardval_gold` = 60 human-verified hard frames. |
| Data — velo19 racket | ✗ RacketVision NOT downloaded (MIT, ~1672 clips/435k frames, train-only, AAAI'26). |
| Data — phone-clip eval | ✗ none (broadcast only). |
| Data — ball/court | ✗ none. |
| Models | ✓ stock zoo (11s/m/l/x, 26s/26m) + 3 finetune weights (ft1, s_replay3k, m_replay3k). |
| Infra — Modal | ✓ authed, A10G GPU, ~$27 left, volume `velo-pose-data`, tokens `MODAL_TOKEN_ID/SECRET` in repo `.env`. Gemini gatekeeper live. |
| Infra — RunPod | ✗ not set up. $3 ≈ 1 short run. Use Modal. |
| Envs | ✓ engine venv (torch 2.5.1) + training venvs (ultralytics 8.3.40/8.4.60). |

**Key measured numbers (don't re-derive):**
- CPU per-frame: yolo11s ≈80 ms, yolo11l ≈221 ms (Apple Silicon; threads ≈ no help: 8-thread 221 vs 1-thread 213).
- hardval_gold: stock yolo11s **0.762 / 0.466** (mAP50 / mAP50-95); yolo11l **0.893 / 0.602**; yolo11x 0.944/0.728 (inflated — excluded).
- Real-footage e2e (GVHMR tennis.mp4, VFR): meanKpConf 0.97, forehand detected, dense pass → `hipsBeforeArm=true` @33ms. ~55s wall for a 10s clip (dense over 5 strokes) → **R1: Koyeb 2–3× slower will bust 60s budget.**

---

## 5. Roadmap

### Phase 1 — Deterministic workflow (NOW, $0, no monitoring)
Files: `lib/velo-engine/src/{yolo_analyze.py, kinematics.py, models.py}`, startup/Dockerfile.
1. Quantize keypoints to grid `G` immediately after YOLO; feed only quantized kpts downstream.
2. Round normalized proxies before `classify_stroke_phase` cutoffs; dead-band + min-index tie-break in peak/argmax/`find_peaks`.
3. Output rounding: angles 1°, velocity 0.1 TL/s, timestamp = integer frame index.
4. Pin: `torch.set_num_threads(1)`, `use_deterministic_algorithms(True)`, seed, weights SHA, version pins.
5. Replace CFR-in-hash-path: drop transcode from determinism; VFR timestamps via real PTS (PyAV); hash the quantized keypoint stream.
6. Add `determinism` block to telemetry + a `hash` field; self-test "same input ×2 → same hash" (script + CI).
7. (Before finalizing `G`) measure real keypoint drift: YOLO ×2 at 1 vs 8 threads on the same frames → diff.

### Phase 2 — velo19 racket head (Modal credit; needs sign-off: spend cap + cadence)
1. Download RacketVision (`OrcustD/RacketVision`, MIT) — train-only, do not redistribute frames.
2. Prep to a `[19,3]` kpt dataset (COCO-17 + racket_butt idx17 + racket_tip idx18); reuse `prepare_dataset.py` patterns + the `velo_loss.py` custom-19-sigma placeholders (uncomment idx17/18 weights 2.4/2.6).
3. Launch on Modal A10G (`train.py` recipe, 2-stage freeze→unfreeze).
4. **Scheduled Claude agent monitors:** poll run, eval each candidate vs the gate, iterate, pick best, report; STOP at the spend cap.
5. Gate: ship only if it earns racket kpts AND doesn't regress body pose; validate broadcast→phone domain gap before trusting. Single 19-kpt head (lower friction) is the leaning approach; separate RTMPose head is the fallback if body-keypoint forgetting reappears.
6. Schema is pre-wired: `KeypointSpec.indexing="velo19"`, `EngineInfo.racket_keypoints`, `JointAngles.racket_face_deg`.

**Open before Phase 2 starts:** user must give (a) hard Modal-credit cap I may spend autonomously, (b) confirm the scheduled/unattended agent, (c) confirm RacketVision download.

---

## 6. Risks / open items

- **R1 (top):** Koyeb CPU latency unmeasured — gates the dense pass + yolo11l swap. Dense pass behind `DENSE_STROKE_WINDOW`.
- Keypoint drift number unmeasured → grid `G` provisional (0.1px).
- velo19 broadcast(RacketVision)→phone domain gap could repeat the body-pose collapse.
- No phone-clip hardval → no absolute accuracy number for anything yet.
- Cross-hardware exact determinism impossible — committed to "pinned-env reproducible" + honest framing.

---

## 7. Suggested skills (resuming agent)
- `caveman` (user preference — terse).
- Phase 1 is pure implementation; after it, `code-review` (high) before commit.
- Phase 2 monitoring: `schedule` or `loop` for the unattended agent (with spend cap).
