# Velo NN — Progress & Research Report

**Scope:** the Tier-1 pose/NN effort — deterministic auditable telemetry (Phase 1, shipped)
and the velo19 racket-keypoint experiment (Phase 2, null result). Written to be the
open-source-citable record of what we built, what we measured, and what we honestly
concluded. Companion working docs: `VELO-NN-MASTER-LOG.md`, `ENGINE-V2-INTEGRATION.md`,
`GEMINI-DETERMINISM-HANDOFF.md`, `lib/velo-training/docs/ITERATION-LOG.md`.

Dates: 2026-06-04 → 2026-06-06. Branch: `feature-nn-engine-v2` (off `origin/main`, not pushed).

---

## 0. Executive summary

1. **Determinism (Phase 1) — shipped & proven.** The engine now emits a byte-identical
   `telemetryHash` for the same input across fresh processes and thread counts
   (`OMP_NUM_THREADS=1` vs `8`). Measured same-architecture keypoint drift = **0 px**, so
   pinning makes reproducibility a guarantee. Honest scope: reproducible on the *same
   pinned arch/image*, not arbitrary CPUs — stated, not hidden.
2. **velo19 racket head (Phase 2) — single-head NULL, separate-head WIN.** A single `[19,3]`
   pose head (COCO-17 body + racket butt/tip) trained on broadcast RacketVision learns racket
   (held-out mAP50-95 **0.642**) but **collapses hard-case body pose** (hardval 0.105 vs stock
   0.466) — catastrophic forgetting. So we pivoted to a **separate racket-only `[5,3]` model**
   (class=racket, no body keypoints): it localizes racket butt/tip just as well (**mAP50-95
   0.619**, mAP50 0.863, detection box 0.893) **with body pose untouched by construction** (no
   collapse). Answers Gemini Q3 empirically: **use the separate racket head, not the single
   head.** Total Modal spend ~$8 of $12 (one $1.50 velo19 run + one ~$6.6 racket run that hung
   to near the timeout — timeout since tightened to 3h). Unattended monitors enforced the cap
   and the adaptive stops.
3. **Method that produced these:** research/audit/review run as multi-agent workflows with
   adversarial verification; every quantitative claim measured, not assumed; null results
   reported as first-class outcomes.

---

## 1. Context: what Velo is and the unowned lane

Velo turns one phone clip of a tennis student into an auditable, biomechanically-grounded
coaching report committed on-chain. The thesis: **"convert pixels to symbols first — never
ask an LLM to do geometry."** The NN only localizes joints; every biomechanical number is
deterministic NumPy/SciPy. No mature, permissively-licensed, CPU-shippable OSS project takes
a single phone clip → auditable per-joint telemetry + verifiable LLM coaching; that seam,
published with its honesty layer, is the contribution.

---

## 2. Phase 0 — external consult and where it was corrected

We consulted Gemini twice on NN direction, then validated against the actual code +
literature. Three of its recommendations **flipped under evidence**:

| Gemini said | Evidence | We did |
|---|---|---|
| One-Euro smoothing | causal filter ⇒ lag/peak-shift; wrong for a persisted/on-chain number | **zero-phase Butterworth** (`filtfilt`, deterministic, no peak shift) |
| order/Kendall-τ kinematic sequence | 360 Hz lab studies can't resolve adjacent-segment peak order; pelvis↔trunk lag ~28 ms is sub-frame | **speed-GAIN magnitude primary**, ordering gated to the coarse hips-before-arm hand-off only |
| "densify the stroke slice" + `idx/fps` timing | `cv2` frame-seek unreliable on phone VFR; `idx/fps` wrong for VFR | **Pass-0 CFR normalization** + two-pass dense decode; real PTS |

Gemini's determinism math (angle-error propagation, rounding grid) was used; its key
self-contradiction was caught: rounding does not *eliminate* cross-arch nondeterminism, it
*moves* the boundary-straddle (fraction = 2·drift/grid). The honest resolution (§3) is
pin-one-arch + round, not "bit-identical anywhere."

---

## 3. Phase 1 — deterministic, on-chain-auditable telemetry

**Problem.** For an on-chain verdict, the same clip must yield the same committed value.
Audit found 14 root-cause nondeterminism sources (full list in the audit worklist):
torch threads/seed/deterministic-algos unset; BoT-SORT tracker state-bleed (`persist=True`
on a global singleton) + unseeded optical-flow GMC; ffmpeg/x264 non-reproducibility;
float-reduction order (`np.mean`/`dot`/`argmax` ties); `Counter.most_common` insertion-order
ties; no canonical hash.

**Measured (the finding that reframed the work):** on one machine, YOLO11s CPU inference is
**already bit-identical** run-to-run, even across thread counts (0.000000 px drift). So
same-arch reproducibility is essentially free; pinning turns it into a guarantee, and
rounding/tie-breaks are cross-arch insurance.

**Solution (R1–R14, all shipped):** `determinism.py` (pin single-thread+seed+deterministic-
algorithms at import; canonical sorted/rounded JSON `telemetryHash`; runtime fingerprint =
weights SHA + lib versions); per-analyze BoT-SORT reset + vendored `botsort_pinned.yaml`
(`gmc_method:None`); device=cpu/fp32; round keypoints before geometry; scalar+`fsum`+round
angle math (N-D); `lru_cache` Butterworth coeffs; integer-frame timing gate; explicit
total-order tie-breaks (subject selection, dominant stroke, dense-pass match); ffmpeg
bit-exact + a decoded-frame-stream hash anchor (hash pixels, not codec bytes).

**Proven:** `test_determinism.py` → identical `telemetryHash` across two fresh processes
**and** `OMP=1` vs `OMP=8`. Adversarial review workflow stalled (infra); reviewed manually,
fixed one latent regression (angle fn restored to N-D for the demoted MediaPipe path).

**Honest scope.** Cross-microarchitecture bit-identity is impossible for NN floats; rounding
shrinks but cannot remove the boundary-straddle. The committed model: hash computed in the
pinned canonical container; auditors re-run that image. Stated in the `telemetryHash`
semantics, not papered over.

Commit `9a21a9fb`. Honesty contract carried in-schema: `wristIsProxy`, `velocityScaleSource`
(refuses mph), `timingResolvable`, consistency≠symmetry.

---

## 4. Phase 2 — velo19 racket head (the experiment)

**Hypothesis.** Extend the pose head from 17 → 19 keypoints (add `racket_butt` idx17,
`racket_tip` idx18) — the first genuinely-custom NN value (no stock model emits racket
keypoints). Open question (Gemini Q3): single `[19,3]` head vs a separate racket model?

**Data pipeline (`build_velo19.py`).** RacketVision (MIT, HF `linfeng302/RacketVision`,
tennis subset 1.9 GB) provides racket 5-keypoints (`top/bottom/handle/left/right`) but **no
body pose**. So: extract racket-labeled frames from clips → pseudo-label body COCO-17 with a
yolo11x teacher → map top→tip, bottom→butt → assign racket to the player whose box contains
it (98% in-box after fixing a nearest-center mis-assignment; 84% keep-rate, distant/occluded
owners rejected) → emit `[19,3]` labels. **Anti-collapse:** pad the existing tennis-17
`data/merged` to 19-kpt (racket cols `0 0 0`, OKS-ignored) and mix in, to keep body
keypoints supervised. Result: 4,679 racket frames + 2,008 padded, leakage-safe split by match.

**Gate.** Local 1-epoch dry-run confirmed the `[19,3]` head adapts (17→19) and trains, 0
corrupt labels — before any spend.

**Training & eval.** Two-stage freeze→unfreeze on Modal A10G, weighted kinetic-chain loss
(racket sigmas 2.4/2.6). `eval_velo19.py` measures racket (velo19 test split) and body
(19-padded hardval, collapse signal). Run `velo19_s_w100`:

| axis | mAP50-95 | mAP50 | box mAP50 |
|---|---|---|---|
| racket (velo19-test) | **0.642** | 0.932 | 0.949 |
| body (hardval, 19-padded) | **0.105** | 0.179 | 0.585 |

**Result: NULL.** The head learns racket on broadcast (0.642) but body pose **collapses** on
the hard set (0.105 vs stock 0.466) — the same broadcast→hard-domain narrowing that killed
the body-finetune (0.762→0.149). The 2,008-frame anti-collapse mix is outweighed by 3,646
broadcast racket frames co-training the shared head.

**Conclusion (answers Gemini Q3).** A single `[19,3]` head co-trained on broadcast data
cannot add racket keypoints without collapsing hard-case body pose. The shared pose head
means body and racket can't be isolated by freezing. **Required:** a *separate* racket head
(detector → player crop → racket-only keypoint model, fused downstream) so body weights are
never touched — or phone-domain body data. Keep coco17 for body.

**Operational note — the system worked.** The unattended monitor (`monitor_velo19.py`, hard
$12 cap, ≤8 launches, adaptive stop on body-collapse) auto-evaluated run 1 and **stopped on
collapse**, declining to spend the remaining ~$10.50 on variations of the same dead approach.
Two launch bugs (modal 1.4 not auto-mounting `velo_loss`; first-build exceeding the submit
timeout) were caught with zero spend. Total spend: **~$1.50**.

---

## 5. Key measured numbers (don't re-derive)

- CPU per-frame (Apple Silicon, lower bound on Koyeb): yolo11s ≈80 ms, yolo11l ≈221 ms; threads ≈ no help (1-thread 213 ms vs 8-thread 221 ms).
- Same-arch keypoint drift: **0 px** (incl. across thread counts).
- hardval_gold stock: yolo11s 0.762 / 0.466 (mAP50 / mAP50-95); yolo11l 0.893 / 0.602.
- velo19_s_w100: racket 0.642, body-hardval 0.105 (uniform-sigma; collapse vs 0.466).
- Real-footage e2e determinism: identical hash across fresh processes + OMP 1↔8.

---

## 6. Reusable assets
`determinism.py`, `test_determinism.py`, `botsort_pinned.yaml`; `build_velo19.py`,
`eval_velo19.py`, `monitor_velo19.py` (the unattended-experiment harness, hard-cap +
adaptive-stop — reusable for the separate-head attempt); RacketVision tennis subset
(`data/racketvision`); velo19 `[19,3]` dataset (`data/velo19`, also Modal volume `/velo19`).

---

## 7. Result: separate racket head (option 1) — WORKS

Trained a racket-only `[5,3]` YOLO-pose model (class=racket; RacketVision bbox + 5 keypoints
top/bottom/handle/left/right; 5731/818/846 split; no body, no teacher pass — `build_racket.py`).
Two-stage, imgsz 960, on Modal A10G (`racket_960_w`). Held-out eval (`eval_racket.py`):

| metric | value |
|---|---|
| racket pose mAP50-95 | **0.6188** |
| racket pose mAP50 | 0.8633 |
| racket box mAP50 | 0.8934 |

The detector localizes the racket fine at full-frame imgsz 960 (the "too small at 13 px" worry
was unfounded), and because the model is racket-only the **stock COCO-17 body model is never
touched — no body collapse**. This is the architecture velo19's null pointed to, confirmed.

**Next: engine fusion (productize).** Run this racket model as a second analyzer in the engine:
stock coco17 (body) + racket model (butt/tip); associate the racket to the player; populate
`JointAngles.racket_face_deg` + `racket_tip`/`racket_butt` (idx17/18) and flip
`KeypointSpec.indexing="velo19"`, `EngineInfo.racket_keypoints=True`. Body telemetry unchanged,
so it carries Phase-1 determinism + honesty. Then upgrade the wrist proxy → true wrist-snap
(the racket-tip unlock). Caveat unchanged: trained on broadcast; phone-domain racket transfer
still unproven (no phone racket eval).
- R1 (Koyeb CPU latency) still gates the dense pass + yolo11l swap — unmeasured on target.
- No phone-clip hardval ⇒ no absolute phone accuracy for anything yet (the real eval gap).
- Determinism cross-arch: declare the canonical arch/image; verifiers re-run it.

---

## 8. Honesty register (what we will not overclaim)
- No single "accuracy %"; figures are layered + caveated (pose mAP is a relative gate, not coaching accuracy).
- velo19 single-head is a **null result**, reported as such.
- Determinism is "reproducible in the pinned env," not "bit-identical anywhere."
- Removed/forbidden figures stay removed: "98% accuracy", "34.4→76.0".
