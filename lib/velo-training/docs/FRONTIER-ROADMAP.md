# Velo Tennis Analyzer — Frontier Roadmap

Distilled from the 17-agent frontier-mapping + adversarial-verify run (9 dimensions).
**Do not invent or extrapolate** beyond what the verify agents confirmed.

---

## The open gap Velo owns

There is no mature, permissively-licensed, CPU-shippable open-source project that takes a single phone clip of one student and returns auditable per-joint biomechanical telemetry plus verifiable LLM coaching. Every OSS tracker (abdullahtarek, yastrebksv, ArtLabss, TRACE) does ball/court/player tracking and match stats — they are broadcast-biased, tutorial-grade, and mostly unlicensed; none touch pose/biomechanics/coaching. Every pose→biomechanics→LLM coaching effort (Talking Tennis arXiv:2510.03921, ICCV-W 2025 Wang/TAGS, BioCoach arXiv:2603.26938) is a research preprint with no released code, often requires 3D/Kinect data, and has no single-phone-clip or on-chain story. Velo's existing seam — YOLO11s-pose → NumPy geometry → TennisTelemetry v2 → quarantined dual-LLM with deterministic checkpoint → Somnia on-chain receipt — is already the thing nobody ships. The defensibility is execution: open, permissive, CPU-shippable, deterministic/auditable, on-chain receipt, none of which those papers offer.

---

## Per-Dimension Table

| Dimension | Recommended Approach | Wow Factor | Effort | Verified Priority | Key Recommendation |
|---|---|---|---|---|---|
| Landscape gap / what Velo owns | build (own the deterministic telemetry contract) | high | M | high | Publish the auditable per-joint telemetry contract openly; position as the lane no OSS or paper occupies |
| Ball tracking (WASB, contact, speed, placement) | adopt | show-stopper | L | **must-have** | Adopt WASB-SBDT (MIT, 1.5M params, Tennis F1 95.6); fuse ball-to-wrist distance for true contact frame; ONNX export + Koyeb CPU benchmark BEFORE promising live — WASB ships no demo/no ONNX, V100-measured speed does not transfer directly |
| Court homography → court-coordinate analytics + minimap | adopt + finetune | show-stopper | L | high | Train your OWN court model on the MIT HF dataset (never ship yastrebksv unlicensed weights); use roboflow/sports (MIT) homography recipe; one homography per static clip = CPU-cheap |
| Racket keypoints (velo19) + contact-frame | adopt + finetune | show-stopper | L | high | RacketVision (MIT, AAAI 2026 Oral) is the first dataset with tennis racket 5-kpt + ball jointly; run as a SECOND RTMPose model on the player crop (Apache-2.0, ~11ms/crop CPU), not bolted onto the 17-kpt head |
| Biomechanics / 2D→3D lifting (kinematic sequence, X-factor) | build | high | M | high | Ship Phase A NOW (kinematic-sequence timing from existing 2D keypoints, pure NumPy); Phase B 3D (MotionBERT, Apache-2.0) is offline-only, uncalibratable vs tennis ground truth — gate as low-confidence |
| Temporal pose: smoothing, 5-phase segmentation, stroke-type AR | adopt + finetune | high | L | high | Layer 1 (One-Euro, BSD): ship now; Layer 2 (5-phase multi-signal segmentation, NumPy): highest perceived-quality/effort; Layer 3 (ST-GCN++ via MMAction2, Apache-2.0): realistic ~74–82% ceiling, surface `type_confidence` always |
| Grounded coaching LLM + honest evaluation | adopt | high | M | high | Adopt SportsGPT pattern (structured-context injection + comparison-to-ideal block); on-chain verdict MUST be code-computed scalar, not LLM token; replace invented 98% / overallScore with honest Adaptive Precise Boolean rubric |
| Viz / UX overlays (broadcast skeleton, minimap, kinematic timeline) | adopt | show-stopper | M | high | supervision (MIT) drops onto YOLO11s-pose output for skeleton/angle overlays; kinematic-sequence timeline is a custom build (no off-the-shelf exists); defer minimap/ball-trail to offline path (TrackNet is ~50 min/2 min clip on CPU) |

---

## Licensing Landmines

### DO-NOT-VENDOR (no license declared / all-rights-reserved)

| Repo | Stars | Status | Notes |
|---|---|---|---|
| `abdullahtarek/tennis_analysis` | 857 | **DO-NOT-VENDOR** | No LICENSE file → all-rights-reserved. Safe to study; cannot copy code or weights commercially. |
| `yastrebksv/TennisProject` | 223 | **DO-NOT-VENDOR** | No LICENSE file → all-rights-reserved. Reference architecture only. |
| `yastrebksv/TennisCourtDetector` | 262 | **DO-NOT-VENDOR** | No LICENSE file (GitHub API license=null, /blob/main/LICENSE → 404). The HF re-upload `Gholamreza/tennis_court_keypoints_dataset` claims MIT but is a unilateral assertion on unlicensed broadcast frames — treat dataset as best-effort, not clean chain of title. Mitigate by retraining from scratch. |
| `yastrebksv/TrackNet` (PyTorch impl) | — | **DO-NOT-VENDOR** | No LICENSE file. Cannot vendor code or weights. Reimplement or use WASB (MIT). |
| `hgupt3/TRACE` | 151 | **DO-NOT-VENDOR** | No LICENSE file → all-rights-reserved. |
| `AggieSportsAnalytics/CourtCheck` | 40 | **DO-NOT-VENDOR** | No LICENSE file → all-rights-reserved. |
| `asigatchov/fast-volleyball-tracking-inference` | — | **DO-NOT-VENDOR** | No LICENSE file (verify agent confirmed: NOT MIT as stated in finding — unconfirmed; use only as CPU-FPS existence proof, not for code adoption). |

### DISQUALIFIED — explicitly non-commercial license

| Repo | License | Notes |
|---|---|---|
| `facebookresearch/VideoPose3D` | CC-BY-NC | Non-commercial. Real landmine if grabbed for the 3D-lifting path. |
| `jhwang7628/monotrack` (Adobe) | Adobe Research License | Non-commercial, revocable. Do NOT ship. |
| `cure-lab/SmoothNet` | Non-commercial (despite Apache header in code) | LICENSE file restricts to non-commercial scientific research. Offline teacher/eval use only; never ship in product. |
| T3Set dataset | CC-BY-NC-SA-4.0 | Table-tennis coaching dataset. Taxonomy/methodology learnable; data non-shippable commercially. |

### SAFE TO ADOPT (permissive / verified)

| Repo / Dataset | License | Notes |
|---|---|---|
| `nttcom/WASB-SBDT` (code + pretrained tennis weights) | **MIT** | Confirmed MIT. Weights trained on NYCU TrackNet dataset (research-only license) — grey area commercially; safest path is MIT code + retrain on permissive data, or get written clearance. |
| `ArtLabss/tennis-tracking` | **Unlicense** (public domain) | The one copy-safe full tennis tracker. Bundled TrackNet weights carry unclear training-data provenance — code is safe; weights are a caveat. |
| `roboflow/supervision` | **MIT** | Clean drop-in for skeleton/overlay rendering. |
| `roboflow/sports` (minimap recipe) | **MIT** | CAVEAT: its RADAR demo imports ultralytics (AGPL-3.0); re-implement the findHomography recipe on a non-AGPL detector to avoid AGPL inheritance. |
| `HarshTomar1234/Tennis-Vision` | **MIT** | Integration scaffold (homography to minimap). Self-reported accuracy only; not independently validated. |
| `OrcustD/RacketVision` + `linfeng302/RacketVision` (HF) | **MIT** | AAAI 2026 Oral, 1,672 clips / 435,179 frames, tennis racket 5-kpt + ball. Broadcast frames carry third-party copyright (train-only; do not redistribute raw frames). |
| `open-mmlab/mmpose` (RTMPose, MotionBERT) | **Apache-2.0** | RTMPose ~11ms/crop CPU via ONNXRuntime. MotionBERT weights Apache-2.0 confirmed. MMPose-bundled VideoPose3D weights still carry CC-BY-NC — only MotionBERT weights are clean. |
| `open-mmlab/mmaction2` (ST-GCN++) | **Apache-2.0** | Use for ST-GCN++ training, not pyskl (unmaintained Mar 2023). |
| `Walter0807/MotionBERT` (code + HF weights) | **Apache-2.0** | Shipped checkpoint is ~37.2mm MPJPE (paper headline 35.8mm is with full pretraining — quote as ~36–39mm depending on checkpoint). |
| `dottxt-ai/outlines` | **Apache-2.0** | Constrained decoding for hardening Q-LLM / P-LLM output to JSON schema. |
| `wannesm/dtaidistance` | **Apache-2.0** | DTW for amateur-vs-pro joint-angle alignment. |
| `casiez/OneEuroFilter` | **BSD-3-Clause** | The only commercial-safe live keypoint smoother. Drop into the Observation loop. |
| `kennymckormick/pyskl` | **Apache-2.0** | Unmaintained (Mar 2023). Reference only; use MMAction2 for new training. |
| Mendeley `nv3rpsxhhk` Tennis Player Actions dataset | **CC BY 4.0** | 2,000 images (FH/BH/ready/serve), COCO-17+neck, 1280x720. Best permissive fit for body-pose finetune and 4-class stroke head. |
| `opencap-core` (Stanford OpenCap) | **Apache-2.0** | Built for gait/clinical, not fast occluded tennis. Use as accuracy-ceiling reference (multi-cam 3.85° MAE; transverse-plane CMC only 0.51–0.6 — the weakest plane for tennis). |

### Datasets — license posture

| Dataset | License | Commercial use |
|---|---|---|
| THETIS (8,374 clips, 12 stroke classes) | No explicit license (cite-on-use) | Research/train-from only; do not redistribute |
| TrackNet ball dataset (NYCU) | "Other" / research | Not confirmed commercial-OK — grey area for shipped weights |
| Human3.6M | Academic non-commercial | Research only; do NOT ship-train on it |
| MPI-INF-3DHP / AMASS / EMDB | Research-only (mixed) | Do not ship |
| WASB-SBDT ball datasets (soccer/volleyball/basketball) | Research-varied | Verify per sub-dataset |

---

## Fabricated / Wrong / Overconfident — Verify Agent Flags

### Dimension 1 (Landscape gap)
- `abdullahtarek/tennis_analysis` ball detector is **YOLOv5** (finding said YOLOv8) — minor version error.
- `TRACE` uses MediaPipe for player body tracking — finding called it "tracking/visualization only." Gap claim still holds (no biomechanics/coaching), but TRACE is not purely non-pose.
- Hawk-Eye uses **"6 or more" cameras**, not "~10" as stated.
- **BlurBall is table-tennis domain** (64k table-tennis frames), not lawn tennis — architecturally relevant but domain differs; re-train before using for tennis.
- TAGS "5 dims (stability/coordination/power/technique/rhythm)" detail could not be independently confirmed from the abstract.
- BioCoach code availability remains **unconfirmed**.

### Dimension 2 (Ball tracking)
- WASB's published speeds (35 FPS Step=1, 58 FPS Step=3) are **V100 GPU numbers** — readers must not conflate with CPU feasibility. CPU-live is plausible-not-proven.
- WASB ships **only benchmark-eval code** — no ONNX export, no inference-on-arbitrary-video script, training code "TBA." "Near drop-in" framing undersells the engineering required.
- `asigatchov` volleyball repo has **no LICENSE file** — "MIT-family claimed" is unverified; use only as CPU-FPS existence proof.
- `yastrebksv/TennisCourtDetector` is unlicensed — "recommended homography port" is not shippable as-is.

### Dimension 3 (Court homography)
- The HF `Gholamreza/tennis_court_keypoints_dataset` MIT claim is a **unilateral re-uploader assertion** on broadcast frames the original repo doesn't license — not a clean chain of title. Treat as best-effort. HF dataset viewer currently throws `DatasetGenerationError`; verify download/parse before Modal train.
- The 0.963 precision / 1.83px median is the repo's **own broadcast-split self-report**, not independently validated.

### Dimension 4 (Racket keypoints)
- Finding cites "SPEC-3 §2.3" — **no §2.3 exists**; the OKS-sigma concern lives in §2 item 3. More critically, SPEC-3 §6d **explicitly recommends the single bolt-on 19-kpt model** (kpt_shape=[19,3] + `velo_loss.py` custom-sigma subclass, which already exists). The finding inverts what SPEC-3 says. Finding's two-model approach (separate RTMPose on crop) is still architecturally sound but it **overrides** SPEC-3 §6d, not follows it.
- `TrackNetV3` is a **badminton shuttlecock tracker** natively — the 87.7%→97.5% accuracy figures are shuttlecock numbers. WASB-SBDT is the correctly-justified tennis ball tracker.
- Audio cross-check F1 92.39% is from a **tennis acoustic-event paper (ACM MMSports)**, not padel/table-tennis as implied.

### Dimension 5 (Biomechanics / 3D lifting)
- MotionBERT 35.8mm MPJPE is the **paper headline with full pretraining**; shipped checkpoint is ~37.2mm (finetuned) / 39.2mm (scratch). Quote as "~36–39mm depending on checkpoint."
- Phase A kinematic-sequence timing resolution in ms is **bounded by sample_rate**; default sample_rate=5 gives 33–200ms granularity — too coarse for credible proximal→distal timing. Raise sample_rate for the stroke window.

### Dimension 6 (Temporal pose)
- THETIS "best published = SlowFast ~74%" is **overstated** — real published range is 74–82% (attention-GRU+DenseNet = 82%; CNN-LSTM/SlowFast-class ~74–79%). Honest-prior conclusion survives; do not anchor "74% is the ceiling."
- Mendeley keypoint count is "COCO-18" (17 COCO + neck = 18, OpenPose-style) — same as the body-pose finetune schema (drop neck = drop-in). Under-sold by the finding.

### Dimension 7 (Coach LLM)
- **"34.4 → 76.0" structured-context-injection figure: DO NOT CITE.** Verify agent could not locate this in SportsGPT, in any sports-coaching LLM paper, or in any topological-sort graph paper. It is unverified and likely misremembered. Cite SportsGPT ablation instead: **3.9 → 2.85 on a 1–5 Likert**.
- SportsGPT baselines are "GPT-5, Claude 4.5 **Opus**, Gemini 3 **Pro**, GLM 4.6V" — the finding drops "Opus"/"Pro" and omits GLM 4.6V entirely.
- `lib/velo-agents/src/ai/schemas.ts` is still on the **v1 schema** (strokePhases/peakAngles/symmetryScore at lines 26–29; no strokes[]) — the prompt rewrite also depends on agent-side schema migration, not just prompts.ts.

### Dimension 8 (Viz / UX)
- `tslearn` license is **BSD-2-Clause**, not BSD-3 (immaterial — still permissive).
- `roboflow/supervision` version cited as v0.26.x; current version is **0.28.0** (Apr 2026).
- roboflow/sports RADAR demo imports ultralytics (AGPL-3.0) — re-implement findHomography recipe on a non-AGPL detector or you inherit AGPL.

---

## The Roadmap

### Critic's synthesis

The finding set is collectively near-complete across the pose→telemetry→LLM spine plus ball/court/racket sensor unlocks, 3D lifting, temporal/action layers, the grounded-LLM coach, and viz. The critic adversarially verified every integration claim against the live codebase (models.py, kinematics.py, compare_report.md, eval_results.json) — claims are real, not aspirational.

**What no finding owns (critical gaps):**
- **G1 — Calibration/metric scale (CRITICAL).** Every "real-world number" (mph, meters) silently assumes scale. Court homography gives ground-plane metric transform; ball speed and racket-head speed live off the plane and need intrinsics or a known reference length. Wrong mph is worse than no mph. Must add `confidence`/`units`/`scale_source` schema fields as first-class citizens.
- **G2 — Frame-rate / shutter / motion-blur trust gate (unowned).** Contact-frame accuracy, ball speed, and kinematic-sequence timing are all bounded by source FPS and rolling-shutter on phone clips. 30fps cannot resolve a 4ms impact; default `sample_rate=5` decimates further. Cheap to add; essential for honesty.
- **G3 — Phone-clip eval set analogous to hardval_gold (partially unowned).** All court/ball/racket datasets are broadcast footage. Without a phone-clip hardval, you will repeat the pose-forgetting failure (0.762→0.149) on every new model.
- **G4 — Audio contact detection as standalone ship-now candidate (mis-bucketed in finding 4).** Tennis audio contact F1 92.39% (ACM MMSports). CPU-live, no ball model, de-risks contact timing immediately. Should be its own track.
- **G5 — Rally/point segmentation (unowned for single clips).** LLM coach needs rally boundaries to avoid averaging across unrelated shots. Low-effort NumPy from existing wrist-velocity peaks.

### (a) Ship-now-cheap wins

| # | Item | Source | Effort | Why now |
|---|---|---|---|---|
| 1 | One-Euro keypoint smoothing | F6 L1 | S | BSD, CPU-live, pure upside. Insert in Observation loop in `yolo_analyze.py`. Prereq for honest sequence timing. |
| 2 | Kinematic-sequence timing (proximal→distal peak-velocity) | F5 Phase A | S–M | Highest credibility-per-dollar number. Pure 2D from existing keypoints, no new model. Needs higher `sample_rate` than default 5. |
| 3 | 5-phase stroke segmentation + rally split | F6 L2 + G5 | M | Replaces 3-member jittery `classify_stroke_phase`. Plain NumPy, on-chain-reproducible. |
| 4 | Input-quality + units/calibration contract | G1 + G2 | S–M | Schema fields: `scale_source`, `units`, `confidence`, `clip_quality_gate`. Refuse mph when you can't earn it. |
| 5 | supervision overlay (skeleton + angle annotations) | F8 | M | MIT, CPU-live, drops onto YOLO11s-pose output. First visible "whoa." Defer minimap/ball-trail (gated on court + ball). |
| 6 | Audio contact-frame detection | G4 | S–M | CPU-live, no ball model, de-risks contact timing immediately. Fuse later with ball for redundancy. |

### (b) The 2–3 "stop-and-stare" show-stoppers

1. **Ball tracking (WASB-SBDT, MIT) → true contact + ball-speed/placement** (F2, effort L, offline-first). The biggest analyst-credibility jump. Fixes the wrist-peak contact proxy. Critical caveat: WASB ships **no ONNX, no demo, no training code**; 35/58 FPS are V100 GPU numbers — build inference wrapper, export to ONNX, benchmark on Koyeb CPU before promising live. Default to offline path.

2. **Court homography (retrain own model on Modal) → court-coordinate analytics + top-down minimap** (F3, effort L, offline). Maps player/ball into ITF meters (23.77×8.23m singles). Unlocks positioning, coverage, recovery, contact-location-vs-baseline, and the "looks like Hawk-Eye" minimap. Never ship yastrebksv's unlicensed weights — train your own using the existing Modal A10G + Ultralytics harness.

3. **Kinematic-sequence timeline visualization + side-by-side-vs-pro (DTW)** (F5 + F8, effort M). Combines ship-now sequence numbers with a custom timeline chart (no off-the-shelf component exists) and DTW alignment (dtaidistance, Apache-2.0) to a reference pro. License-clean, mostly client-side. The "professional sports analysts stop and stare" piece because it's biomechanics nobody else ships open-source.

*(P2 stretch: racket velo19 keypoints (F4, L) — true racket-head speed/swing path. Explicitly post-MVP; gated on ball + scale. Build after show-stoppers 1–2.)*

### (c) Research-only / skip

- **Monocular 3D lifting (MotionBERT / VideoPose3D)** — F5 Phase B. Offline-only, ~37mm shipped checkpoint, uncalibratable against tennis ground truth, VideoPose3D is CC-BY-NC landmine. Transverse-plane (X-factor, shoulder ER, pronation) is exactly where markerless is weakest. Ship as low-confidence "estimated" only if at all; do not block on it.
- **Spin / Magnus estimation** — research-only, table-tennis sim2real gap. Skip v1. All findings agree.
- **Stroke-type ST-GCN++ classifier** — F6 L3. ~74–82% ceiling, 2D projection ambiguity, CC-BY set is 4-class only. Adopt only with `type_confidence` surfaced, never overclaim.
- **"34.4→76.0" structured-context number** — DO NOT CITE. Unverifiable.
- **"98% coaching accuracy"** — established as false. Best published tennis-LLM expert-agreement is ~76% (SportsGPT Accuracy 3.80/5 vs GPT-5 3.15/5; JMIR Fleiss kappa 0.79–0.82 for movement coaching).

### Critic's next-5-actions for the $40 Modal budget

1. **[$0 — local, do first]** Ship the CPU-live ship-now stack (a-1→a-4): One-Euro smoothing + kinematic-sequence timing + 5-phase segmentation + units/quality contract. No GPU. Highest credibility-per-dollar in the entire plan. Bump `sample_rate` for the sequence-timing path.

2. **[$0 — local, gating]** Get `hardval_gold` human signoff (60 frames) + build a small phone-clip eval set (G3). `compare_report.md` is explicit: nothing trains until this is signed. ~1–2 hrs human labeling. Cheapest thing standing between you and any legitimate ship/finetune claim.

3. **[~$8–12 Modal]** Train your OWN court-detection model (Ultralytics on Modal, your data — never ship yastrebksv weights). Court homography is the highest-wow infrastructure unlock and every positional metric depends on it. Validate against your phone-clip eval set, not just broadcast, to avoid the domain-gap forgetting trap.

4. **[~$5–8 Modal / local + dev time]** Stand up WASB-SBDT ball inference offline + ONNX export + Koyeb CPU benchmark. Use pretrained MIT weights. Spend the dollars proving the latency question (CPU-live vs offline-only) and wiring true-contact (fuse with audio detector from a-6). This + court (#3) is the stop-and-stare pair.

5. **[~$10–15 Modal — only after #2 signoff]** Run the velo19 racket-keypoint finetune experiment (`exp_train.py` / `train.py` already exist; `velo_loss.py` 19-sigma subclass per SPEC-3 §6d). Single bolt-on model, `kpt_shape=[19,3]`. Gated on ball + scale; body-pose MVP must ship first. Keep ≥$5 buffer.

**Spend logic:** ~$25–35 of $40 on GPU for court model, ball benchmark, and racket finetune — the three things that require compute and each independently raise analyst credibility. Everything in (a) is $0 and ships first. The stop-and-stare demo (court minimap + ball trail + kinematic-sequence timeline + true contact frame) is achievable on this budget via actions 1+3+4. 3D lifting and spin stay gated/skipped.

**Brutal-honesty bottom line:** The real risks are G1 (units/scale) and G2 (clip-quality gate) — without them, every mph/meter number is a credibility liability. Land those two cheap schema contracts alongside the ship-now stack, and Velo credibly owns the lane no OSS competitor does: auditable per-joint telemetry + true-contact-anchored, confidence-gated coaching from a single phone clip.

---

*Source: frontier-mapping workflow ae1e09c6 / task wb37zvm5g, 17 agents, 9 dimensions. Verified against live codebase: `lib/velo-engine/src/models.py`, `lib/velo-engine/src/kinematics.py`, `lib/velo-engine/src/yolo_analyze.py`, `lib/velo-training/compare_report.md`, `lib/velo-engine/docs/CODEX-SPEC-3-finetune-autoannotation.md`.*
