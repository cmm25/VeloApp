# Velo — Engineering Handoff for Gemini (NN-Framework Consultation)

**Purpose.** We are asking for your input on NN-framework approaches for a tennis-coaching system. Below is full context: what we are building, the exact architecture, every training experiment we ran and why each failed, and a set of pointed questions at the end. We are not looking for encouragement or a glossy framework comparison — we want your honest opinion on whether our proposed directions are sound, where we are fooling ourselves, and what the highest-leverage next move actually is given our hard constraints. Read the open questions in Section 8 before diving in if you are short on time.

---

## 1. What Velo Is

Velo is an open-source tennis-coaching system that analyzes a single phone clip of a student hitting and returns a biomechanically-grounded coaching report. The user submits a video URL; the engine returns a JSON `TennisTelemetry` object containing per-stroke joint angles, stroke phases, consistency scores, and quality metrics; a dual-LLM reasoning layer (described in Section 2) converts those symbols into a coaching report stored on-chain for auditability.

**Core thesis, verbatim:** *"Convert pixels to symbols first — never ask an LLM to do geometry."*

The neural network only localizes joints. Every biomechanical number (angles, phases, kinematic ratios, consistency) is computed by deterministic NumPy code. The LLM sees numbers, never raw pixels-as-geometry.

**The 3-tier pipeline:**

```
Video (phone clip, single camera)
  │
  ▼
Tier-1:  YOLO11s-pose → 17 COCO keypoints per frame
         (the only NN in production today)
  │
  ▼
Tier-1b: Deterministic NumPy kinematics
         → TennisTelemetry v2 JSON (camelCase, Pydantic/Zod)
  │
  ▼
Tier-2:  Q-LLM (Gemini vision over contact keyframe + telemetry)
         → deterministic checkpoint (Zod + range checks + verb allow-list)
         → P-LLM (Somnia native text inference → Gemini text → Groq fallback)
         → FormReport / PrescriptionReport
  │
  ▼
Tier-3:  Pin report to IPFS → EIP-712 receipt → submit on Somnia (on-chain)
```

The on-chain verdict is a **code-computed scalar, never an LLM token**. Any NN proposal that introduces stochasticity into the final verdict breaks the auditability guarantee.

---

## 2. Architecture in Detail (The Seam)

### Tier-1: YOLO11s-pose

- **Weights:** `_DEFAULT_WEIGHTS = os.getenv("YOLO_WEIGHTS", "yolo11s-pose.pt")` — swappable by env var, lazy-loaded with a thread lock, cached globally.  
  Source: `lib/velo-engine/src/yolo_analyze.py` lines 62–101.
- **Confidence gate:** `KP_CONF_MIN = float(os.getenv("KP_CONF_MIN", "0.5"))`. Frames where required keypoints fall below this threshold are skipped (recorded in `quality.frames_skipped_low_conf`), never hallucinated.
- **Detection conf:** `YOLO_DET_CONF_MIN = 0.1` (low, to catch distant players; keypoint gate is the real filter).
- **Subject selection:** `SubjectStrategy` enum — `auto` (default) picks `most_active` when motion spread > 1.0 px (coach+student in frame) else `largest`. `most_active` = argmax of cumulative joint displacement + bbox area. Multi-person ambiguity is counted but not yet resolved in production (planned for SPEC-1 work, June 2026).
- **Handedness:** auto from wrist path + peak velocity comparison; hint override accepted.
- **Sample rate:** `AnalyzeRequest.sample_rate` default 5 = analyze every 5th frame → ~6 fps on 30fps source. Stroke segmentation is robust to sparsity but phase timing is coarse at this rate.

### TennisTelemetry v2 Schema

Main objects in `lib/velo-engine/src/models.py`:

| Object | Key fields |
|---|---|
| `EngineInfo` | `backbone`, `weights_path`, `kp_conf_min`, `sample_rate`, `coco17=true`, `racket_keypoints=false` |
| `VideoInfo` | `url`, `cid`, `duration_ms`, `fps`, `width`, `height`, `frames_total`, `frames_analyzed` |
| `SubjectInfo` | `selection_strategy`, `track_id`, `handedness`, `handedness_source`, `mean_keypoint_confidence`, `frames_present` |
| `KeypointSpec` | `names: COCO17_NAMES`, `coordinate_system="normalized"`, `indexing: "coco17" \| "velo19"` |
| `StrokeTelemetry` | `type`, `type_confidence`, `start_ms/end_ms`, `phases`, `peak_wrist_velocity_px`, `keyframes[]` |
| `Aggregate` | `peak_angles`, `avg_angles`, `consistency_score`, `dominant_stroke`, `stroke_count` |
| `Quality` | `frames_skipped_low_conf`, `frames_no_person`, `frames_multi_person_ambiguous`, `occlusion_ratio`, `mean_keypoint_confidence` |

**JointAngles (5 fields):**

| Field | What it actually measures | Caveat |
|---|---|---|
| `shoulder` | Elbow→Shoulder→Hip angle (°) | True biomechanical angle |
| `elbow` | Wrist→Elbow→Shoulder angle (°) | True biomechanical angle |
| `wrist` | Forearm orientation vs image vertical (°) | **PROXY, not true wrist-snap.** Will be upgraded to true snap only when `racket_tip` keypoint is added (P2). `wrist_is_proxy: bool = True` is always set. |
| `hip` | Shoulder→Hip→Knee angle (°) | True biomechanical angle |
| `knee` | Hip→Knee→Ankle angle (°) | True biomechanical angle |

`racket_face_deg: Optional[float]` exists in the schema but is always `None` until P2.

### velo19 Pre-Wiring (P2, not live)

`KeypointSpec.indexing: Literal["coco17", "velo19"]` — always `"coco17"` in production. `velo19 = COCO17 + racket_butt (idx 17) + racket_tip (idx 18)`. `EngineInfo.racket_keypoints: bool = False` always. Kinetic-chain OKS-sigma *weights* live in `lib/velo-training/velo_loss.py` (wrists already weighted tightest at 2.2; `racket_butt`/`racket_tip` weights 2.4/2.6 exist as **commented-out placeholders**, to enable once idx 17/18 are annotated). The upgrade path from wrist-proxy → true wrist-snap requires the racket-tip keypoint.

### Tier-2: Dual-LLM Reasoning

Documented in `lib/velo-engine/docs/REVISED-ARCH.md`. The split is forced by a hard modality constraint: Somnia's native LLM-inference agent (`inferChat`) is **text-only**. So:

- **Q-LLM (Gemini 2.5 Flash-Lite, vision):** receives the contact keyframe (base64 JPEG, Q=82) + telemetry symbols. Quarantined — no tools, forced JSON, output is DATA not instructions.
- **Deterministic checkpoint:** Zod schema validation + numeric range checks on every angle/target + verb allow-list + system-prompt-leak regex. Code, not a model.
- **P-LLM (Somnia native Qwen3, primary):** sees validated symbols only, never raw pixels. On-chain receipt. Falls back to Gemini-text → Groq if Somnia unavailable.

**You (Gemini) are the Q-LLM.** The fields you will most likely misread (from schema gotchas): `consistency_score` measures temporal repeatability of angles within a stroke window, not left/right symmetry; `wrist` angle is forearm orientation (proxy), not anatomical wrist flexion; `motion_energy` is cumulative displacement, not velocity.

### Serving Reality

CPU on Koyeb free tier. `/analyze` is a **batch job** (~1 minute per clip), not real-time streaming. A larger model with higher latency per frame is acceptable. `max_duration_s=45` default; rallies longer than 45 seconds are cut at the client.

---

## 3. How We Judge "Good" (Eval Discipline)

**hardval_gold:** 60 human-verified frames (Mixkit clips 869, 873, 876, 877 — free license) selected by maximum keypoint disagreement between stock `yolo11s-pose` and stronger `yolo11x-pose`. Human-corrected in Label Studio by Eshaan (2026-06-03). Labels are **kinetic-chain-focused and recall-light** (mean 9.9/17 joints labeled per frame — shoulders, elbows, wrists, hips, knees only; out-of-crop or occluded joints left as `v=0`, ignored by OKS).

**Metrics (OKS-based):**
- `pose_mAP50` — coarse localization gate (IOU threshold 0.5)
- `pose_mAP50-95` — fine precision metric across IOU thresholds 0.5–0.95; **this is the number that drives joint-angle quality**

**Ship gate (must beat BOTH):**
- `pose_mAP50 ≥ 0.762` (stock yolo11s-pose baseline)
- `pose_mAP50-95 > 0.466` (stock baseline)

**Honest caveats about hardval_gold:**
1. **Recall-light:** mean 9.9/17 joints labeled means OKS is measured only over joints a human placed. It is a valid *relative* gate (same reference for stock and any finetune), not absolute ground truth.
2. **Draft-anchored bias:** labels were human-corrected over `yolo11x-pose` drafts, not redrawn from scratch. `yolo11x` therefore has a mild home advantage (it scores 0.944/0.728 on this set — the highest in the zoo — and that score is inflated). All other models are unbiased against this set.
3. **Broadcast-domain only:** every frame is from Mixkit broadcast-quality clips. No phone-clip eval set exists yet. This is the meta-gap described in Section 5.

---

## 4. What We Tried and Why Each Failed

### Finetune Experiments (all on hardval_gold)

| Experiment | What | hardval mAP50 | hardval mAP50-95 | Outcome & root cause |
|---|---|---|---|---|
| Stock `yolo11s-pose` | COCO-pretrained baseline, no training | 0.762 | 0.466 | **Bar to beat** |
| **#1 Naive finetune** | ~1,610 mostly-easy tennis images, 2-stage 30+70 epochs, select on easy-val | 0.149 | 0.091 | **CATASTROPHIC REGRESSION.** Easy-val mAP50-95 was 0.94 — massive overfit. COCO robustness obliterated. Classic catastrophic forgetting. Cost ~$0.50 Modal A10G. |
| **A1** | yolo11s + 3,000 COCO-person replay + 2-stage (20+40), select on diverse (tennis+COCO) val | 0.773 | 0.396 | **NO-SHIP.** COCO replay fixed the collapse (0.149→0.773 mAP50). Edges stock on coarse mAP50 but **regresses hard-case precision** (0.396 vs stock 0.466). Data is still too easy. |
| **STEP 3 pseudo-label** | Auto-label hard footage (clips 875/879/880) with `yolo11x` teacher + Gemini gatekeeper | — | — | **FAILED TO SCALE.** Only 22 usable frames auto-accepted (exact denominator of attempted frames not precisely logged; "hundreds" rejected). **Pseudo-label paradox:** the teacher model cannot confidently label the hard cases it fails on. |
| **C1** | `yolo11m`-pose (2x capacity) + 3k COCO replay + 22 hard pseudo-frames + 2-stage (20+40) | 0.756 | 0.379 | **NO-SHIP, worse than A1 and stock.** Doubling capacity from 11s to 11m made things worse, not better (0.379 vs A1 0.396 vs stock 0.466). **Capacity is not the bottleneck.** |

**Pattern across all three regressions:** finetuning on the data we can realistically obtain narrows the COCO-pretrained model away from its natural robustness. The progression on `mAP50-95` is: stock 0.466 → A1 0.396 → C1 0.379. Every training step makes hard-case precision worse.

**Bottom line:** the real lever is **model size** (evaluated in the stock zoo below), not training. The true bottleneck is hard-case training data, which is expensive to obtain — pseudo-labeling fails because of the teacher-capability paradox, and human labeling does not scale economically.

### Stock Model Zoo (no training, all COCO-pretrained)

Evaluated after the finetune series to test whether a bigger stock model would simply beat the finetuned ones.

| Model | hardval mAP50 | hardval mAP50-95 | vs yolo11s precision | Rel. CPU latency |
|---|---|---|---|---|
| `yolo11s` (current) | 0.762 | 0.466 | baseline | 1x (~90ms/frame) |
| `yolo26s` | 0.748 | 0.481 | +0.015 | ~0.95x (faster, needs ultralytics ≥8.4) |
| `yolo11m` | 0.910 | 0.552 | +0.086 | ~2x |
| `yolo11l` | 0.893 | 0.602 | **+0.136 (+29%)** | ~2.7x |
| `yolo11x` | 0.944 | 0.728* | +0.262* | ~5.4x |
| `yolo26m` | 0.843 | 0.543 | +0.077 | ~2.4x |

*`yolo11x` score is **inflated** — gold labels were human-corrected over `yolo11x` drafts (home advantage). Exclude from honest ship comparison.*

**Key finding:** `yolo11l` delivers +0.136 (+29%) hard-case keypoint precision over `yolo11s` at zero training cost. The engine is a ~1 min batch job on CPU, making the ~2.7x per-frame latency affordable. Recommended swap: `YOLO_WEIGHTS=yolo11l-pose.pt`.

---

## 5. Honest Constraints and Lessons

**CPU/batch only.** The engine runs on Koyeb CPU (~$0 free tier). Models must be CPU-shippable. "~11ms/crop CPU" numbers from papers (e.g., RTMPose) are typically measured on V100 GPU — treat as unverified until benchmarked on Koyeb.

**No cheap hard data.** The pseudo-label paradox is fundamental: a teacher model cannot robustly label frames where it fails. STEP 3 yielded only 22 usable frames. Human labeling is the only path but does not scale economically. Any NN proposal must account for this or it will repeat the finetune regression pattern.

**2D pose is projection-ambiguous.** A single phone camera cannot recover out-of-plane motion. The transverse plane (shoulder external rotation, pronation, X-factor) is where markerless is weakest — Stanford OpenCap multi-cam achieves only CMC 0.51–0.6 in the transverse plane. We do not claim to measure these correctly.

**Accuracy-framing discipline.** Two figures have been explicitly removed from all documentation:
- **"98% coaching accuracy"** — this was traced to `box_mAP@0.5 ≈ 0.987` on an easy Roboflow split. Box detection accuracy is not coaching accuracy.
- **"34.4 → 76.0" structured-context lift** — appears in earlier internal notes; could not be verified in any cited source. Do not cite. Honest framing: "telemetry-first context improves coaching-LLM quality; exact magnitude unverified." Best published tennis-LLM expert agreement is SportsGPT ~76% (Accuracy 3.80/5 vs GPT-5 3.15/5); no published system exceeds ~80%.

**Modal infrastructure lessons (keep brief):** numpy must be pinned `==1.26.4` (ultralytics 8.3.40 calls `np.trapz`, removed in numpy 2.0); Modal ignores `.env` (tokens must be explicitly exported); `volume.commit()` required after any `/vol` state mutation or changes evaporate.

**Schema sync across three surfaces.** `lib/velo-engine/src/models.py` (Pydantic v2.0, current) / `lib/velo-agents/src/ai/schemas.ts` (Zod, still on v1 — `strokePhases/peakAngles/symmetryScore`) / Gemini Q-LLM prompt. Any telemetry change is dead-on-arrival until all three are migrated atomically.

---

## 6. The Open-Source Landscape and the Gap Velo Owns

There is no mature, permissively-licensed, CPU-shippable OSS project that takes a single phone clip and returns auditable per-joint biomechanical telemetry plus verifiable LLM coaching. Every OSS tracker (`abdullahtarek/tennis_analysis`, `yastrebksv/TennisProject`, `ArtLabss/tennis-tracking`, `hgupt3/TRACE`) does ball/court/match stats only, is broadcast-biased, and is mostly unlicensed. Every pose→coach research paper (Talking Tennis arXiv:2510.03921, ICCV-W 2025 Wang/TAGS, BioCoach arXiv:2603.26938) is a preprint with no released code, often requires 3D/Kinect, and has no single-phone-clip or on-chain story.

**Velo's seam** — `YOLO11s-pose → NumPy geometry → TennisTelemetry v2 → quarantined dual-LLM → deterministic checkpoint → Somnia on-chain receipt` — is already the thing nobody ships.

**License posture (summary):**

| Category | Examples |
|---|---|
| Safe to adopt (MIT/Apache/BSD/CC-BY) | `nttcom/WASB-SBDT` (MIT), `open-mmlab/mmpose` RTMPose (Apache-2.0), `Walter0807/MotionBERT` (Apache-2.0), `roboflow/supervision` (MIT), `casiez/OneEuroFilter` (BSD-3), `OrcustD/RacketVision` (MIT, AAAI 2026), `wannesm/dtaidistance` (Apache-2.0), Mendeley Tennis Player Actions dataset (CC BY 4.0) |
| Do not vendor (no license = all-rights-reserved) | `abdullahtarek/tennis_analysis`, `yastrebksv/TennisProject`, `yastrebksv/TennisCourtDetector`, `hgupt3/TRACE` |
| Disqualified (explicit non-commercial) | `facebookresearch/VideoPose3D` (CC-BY-NC), `cure-lab/SmoothNet` (non-commercial despite Apache header) |
| AGPL inheritance risk | `roboflow/sports` RADAR demo imports ultralytics (AGPL-3.0) — re-implement the `findHomography` recipe on a non-AGPL detector |

---

## 7. Candidate NN Directions We Are Weighing

Listed in priority order, with effort/expected value/risk estimates.

### (a) Knowledge Distillation: Strong Teacher → Small Served Model

**Effort: L | Expected value: medium | Risk: medium**

Train `yolo11s-pose` (the served model) to mimic a strong teacher (`yolo11l/11x` or RTMPose/ViTPose) for teacher-quality keypoints at small-model latency. Two flavors: (1) *response/pseudo-label distillation* — teacher soft-labels unlabeled tennis frames; directly hits the pseudo-label paradox cap (~22 usable frames from hard footage). (2) *Feature distillation* — MSE/attention-transfer loss between teacher and student backbone feature maps; does NOT require confident teacher keypoints on hard frames, partially sidestepping the paradox. The production example of exactly this: DWPose distills RTMPose-x → RTMPose-s/t in `open-mmlab/mmpose` (Apache-2.0).

**Honest caveat:** distillation solves a latency problem Velo may not have. If `yolo11l` is acceptable on a 1-minute batch job (2.7x latency is 243ms/frame vs 90ms/frame — on a 30fps source sampled at rate 5, that is ~270ms per processed frame, affordable), distillation only earns its cost if CPU RAM or latency is a hard constraint. Feature distillation is more promising than response distillation but requires porting from Ultralytics to mmpose/RTMPose.

### (b) velo19 Racket-Keypoint Model

**Effort: L | Expected value: high | Risk: medium**

Extend the Tier-1 pose head from 17 COCO body keypoints to 19 by appending `racket_butt` (idx 17) and `racket_tip` (idx 18). This is the first piece of genuinely custom NN value — no stock model emits racket keypoints. The schema is fully pre-wired: `KeypointSpec.indexing="velo19"`, `EngineInfo.racket_keypoints=True`, `JointAngles.racket_face_deg`, and racket-kpt OKS-sigma-weight placeholders in `lib/velo-training/velo_loss.py` (commented out until idx 17/18 are annotated). Upgrading from wrist-proxy → true racket-head-speed and wrist-snap requires this.

Training data: RacketVision (`OrcustD/RacketVision`, MIT, AAAI 2026 Oral) — 1,672 clips / 435,179 frames, the first dataset with tennis racket 5-keypoint + ball jointly. Broadcast-domain (third-party frame copyright means train-only, do not redistribute raw frames).

Two implementation paths: (A) single `[19,3]` YOLO-pose head (lowest friction, reuses `train.py/exp_train.py/velo_loss.py`); (B) separate lightweight RTMPose head on the player crop fused downstream (better isolation from body-keypoint forgetting). Important: at `kpt_shape=[19,*]` Ultralytics falls back to uniform `1/N` OKS sigmas (non-comparable to COCO baselines); `velo_loss.py` custom sigmas mitigate this.

### (c) Analysis-Layer NN: Temporal Kinematic Sequence, Phase, and Stroke-Type Classification

**Effort: L | Expected value: medium | Risk: low-medium**

Replace brittle kinematics heuristics with learned temporal models over the keypoint sequence. Current `kinematics.py` heuristics: `classify_stroke_phase` uses wrist-peak ×0.95/0.85 cutoffs; `detect_dominant_stroke` is a 4-way if/else on peak shoulder/wrist/hip thresholds. Candidates:
- **TCN / 1D-CNN** over joint-angle time series for 5-phase segmentation (lowest effort)
- **ST-GCN++** via `open-mmlab/mmaction2` (Apache-2.0) for stroke-type classification
- **PoseConv3D** for spatiotemporal action recognition

Training data: Mendeley Tennis Player Actions (CC BY 4.0, 2,000 images, 4 classes FH/BH/ready/serve, COCO-17+neck — cleanest permissive seed); THETIS (8,374 clips, 12 classes, no explicit license, research/train-only).

Realistic published ceiling on stroke-type classification: 74–82% on THETIS/TAGS datasets (attention-GRU+DenseNet ~82%; SlowFast-class ~74–79%). The schema already supports `type_confidence: float` per stroke — always surface it. Note: the pure-NumPy **kinematic-sequence timing** (proximal→distal peak-velocity ordering: hips→trunk→shoulder→elbow→wrist) is a separate, zero-NN item and is the higher-priority deliverable (see ITERATION-LOG.md §"STRATEGIC REDIRECT").

### (d) Ball + Court Fusion

**Effort: L | Expected value: high | Risk: medium (engineering gap)**

Two unlocks:
1. **Ball tracking:** `nttcom/WASB-SBDT` (MIT, ~1.5M params, Tennis F1 95.6) fused with wrist position to detect the true contact frame (today we use wrist-velocity-peak as a proxy). Also enables ball speed and placement.
2. **Court homography:** train our own court-keypoint model (never ship `yastrebksv`'s unlicensed weights) using `roboflow/sports` (MIT) `findHomography` recipe (re-implement on a non-AGPL detector). One homography per static clip is CPU-cheap. Maps player and ball into ITF metric coordinates (23.77 × 8.23m singles court).

Court homography is the keystone for **metric scale** — without it every speed and distance claim silently assumes scale. "Wrong mph is worse than no mph" is a hard constraint. WASB engineering caveat: published 35/58 FPS are V100 GPU benchmarks; no ONNX export or inference script ships with the repo. Must build ONNX wrapper + benchmark Koyeb CPU latency before promising live delivery.

### (e) 2D → 3D Lifting (MotionBERT) for True Joint Angles

**Effort: M | Expected value: low | Risk: medium**

Lift existing 2D COCO-17 keypoint sequences to 3D joints using `Walter0807/MotionBERT` (Apache-2.0, shipped checkpoint ~37–39mm MPJPE — paper headline 35.8mm requires full pretraining). Enables 3D-derived metrics (trunk rotation, X-factor, shoulder external rotation) that 2D projection cannot give.

Honest risk: markerless 3D is weakest exactly in the transverse plane — the planes tennis cares about most (shoulder ER, pronation, X-factor). Stanford OpenCap multi-cam clinical system achieves CMC only 0.51–0.6 in the transverse plane. Uncalibratable vs tennis ground truth. Offline-only; ship as low-confidence "estimated" only, never block on it. Do NOT use `facebookresearch/VideoPose3D` (CC-BY-NC — hard commercial blocker).

### (f) Top-Down Pose: Detector → Crop → High-Res Head (RTMPose)

**Effort: M | Expected value: high | Risk: low-medium**

Two-stage top-down pose: keep the existing YOLO player track/bbox, crop the player, feed the crop to `RTMPose-m` (`open-mmlab/mmpose`, Apache-2.0). Top-down sees the player at full crop resolution instead of ~10% of a 640px letterbox — which is likely the root cause of low `mAP50-95` on distant phone-clip players. RTMPose ships ONNX export + RTMlib for CPU inference.

The engine already produces good player tracks (most-active selection with track continuity), so the detector half is solved. `kinematics.py` geometry is backbone-neutral (same COCO-17 keypoint names), so the swap is a drop-in at the keypoint output layer. Needs zero tennis labels (stock COCO RTMPose weights). The "~11ms/crop CPU via ONNXRuntime" figure from FRONTIER-ROADMAP is a roadmap claim, not a measured Koyeb number — must benchmark before committing.

---

## 8. Open Questions for Gemini

These are the questions we most need answered. Please be direct; "it depends" answers should specify exactly what they depend on.

**Q1 — Is distillation the right play, or should we just ship the bigger model?**
Given our batch-job serving context (~1 min/clip on CPU, tolerates 2.7x latency increase), `yolo11l` is a one-line env swap that buys +29% hard-case precision for $0. Knowledge distillation would recover teacher-quality keypoints at small-model latency but costs significant engineering effort and requires porting away from Ultralytics to mmpose/RTMPose for feature distillation. Is there a scenario where distillation is worth that effort over simply serving `yolo11l`? What would change your answer?

**Q2 — Top-down crop resolution vs bigger stock model: which more directly fixes low mAP50-95 on distant phone players?**
Our working hypothesis is that the `mAP50-95` regression on hard frames is caused by resolution: the player occupies ~10% of a 640px letterbox at phone-clip distances. Top-down RTMPose on the player crop addresses this directly. Does this hypothesis hold, and do you expect RTMPose on a player crop to outperform `yolo11l` on this specific failure mode? Treat the "~11ms/crop CPU" roadmap figure as unverified — answer assuming we need to benchmark.

**Q3 — For velo19 (racket keypoints), single 19-kpt head or separate racket model?**
The single-head path (`kpt_shape=[19,3]`, velo_loss.py custom sigmas) reuses the existing training stack with minimal friction. The separate-head path (RTMPose on crop, fused downstream) better isolates body-keypoint forgetting risk. Given that training data is broadcast-domain RacketVision and the target is phone clips, which approach better protects against the forgetting pattern we saw (yolo11s 0.762 → naive finetune 0.149)? Is the domain gap between broadcast racket training data and phone-clip deployment an equally large problem as the body-keypoint domain gap was?

**Q4 — On-chain determinism: which proposed NN components secretly break the audit guarantee?**
The on-chain verdict must be a deterministic code-computed scalar. The following patterns break this: stochastic post-processing, BN-adapting test-time training (TENT), MLLM-gated data selection loops inside the inference path. As the Q-LLM in our Tier-2 architecture, where exactly does the deterministic boundary need to sit between your vision pass and the downstream code checkpoint? What does that boundary look like in practice — i.e., which fields in your JSON output must be range-checked by the deterministic checkpoint before they can safely influence the on-chain verdict?

**Q5 — As the Q-LLM yourself: what symbols do you actually need beyond our current 5 joint angles?**
You (Gemini) are the Q-LLM in our Tier-2 architecture: you receive the contact keyframe + `TennisTelemetry v2` JSON. What additional telemetry fields would meaningfully improve your ability to give a biomechanically credible observation? And which current fields will you most likely misinterpret without explicit prompt guards — specifically: `wrist` angle is a forearm-orientation proxy (not anatomical wrist flexion), `consistency_score` is temporal repeatability (not symmetry), `motion_energy` is cumulative displacement (not velocity)?

**Q6 — How do we build a phone-clip hardval without repeating the broadcast-domain mistake?**
Every dataset we have (Mixkit, Roboflow exports, RacketVision) is broadcast-quality footage. Our current `hardval_gold` is 60 broadcast frames. Without a phone-clip held-out eval set, any new model (racket, ball, court) risks repeating the 0.762→0.149 forgetting regression when deployed on phone-clip input. What is the cheapest honest path to a ~100–300 frame phone-clip hardval, and how do we design the ship-gate so the regression pattern is caught before deployment?

**Q7 — Sample rate resolution and kinematic-sequence timing honesty.**
Our default `sample_rate=5` gives ~33–200ms granularity per frame. Proximal-to-distal peak-velocity ordering (hips → trunk → shoulder → elbow → wrist) requires resolving lags on the order of 20–50ms. At 30fps source with sample_rate=5, we get 6 analyzed frames per second — too coarse for credible ms-level timing claims. What sample_rate is needed to make kinematic-sequence timing claims honest at 30fps, and how should we express timing confidence in the telemetry schema so the P-LLM does not over-claim?

**Q8 — Unified NN framework spanning pose + ball + court + temporal: maintainability?**
We are considering a roadmap where Tier-1 expands to multiple NN components (body pose, racket-kpt head, ball tracker, court-homography model, optional ST-GCN++ stroke classifier). All feed the same `TennisTelemetry v2` contract. What framework / inference orchestration pattern keeps this maintainable as a small open-source project? Is there a natural architecture that lets each component be swapped or disabled independently without cascading failures in the telemetry output?

---

## 9. Repo Map

| File | Purpose |
|---|---|
| `lib/velo-engine/src/main.py` | FastAPI `/analyze` endpoint; batch dispatch, async executor |
| `lib/velo-engine/src/yolo_analyze.py` | YOLO11s-pose pipeline: subject selection, handedness, angle extraction, stroke segmentation, keyframe export |
| `lib/velo-engine/src/kinematics.py` | Deterministic tennis math: `angle_between`, `classify_stroke_phase`, `stroke_windows`, `detect_dominant_stroke`, `compute_consistency_score` |
| `lib/velo-engine/src/models.py` | Pydantic v2 `TennisTelemetry` + `EngineInfo` + `JointAngles` + `KeypointSpec` schemas |
| `lib/velo-engine/docs/REVISED-ARCH.md` | Hybrid Tier-2 reasoning design: Q-LLM/checkpoint/P-LLM/Somnia split |
| `lib/velo-engine/docs/CODEX-SPEC-3-finetune-autoannotation.md` | Living spec: honest accuracy table, 5-step data pipeline, P2 racket-keypoint forward spec |
| `lib/velo-training/train.py` | Two-stage freeze→unfreeze Modal A10G training recipe |
| `lib/velo-training/exp_train.py` | Modal experiment harness; COCO-replay prep; diverse-val assembly |
| `lib/velo-training/eval_pose.py` | OKS evaluation against hardval_gold; go/no-go gate |
| `lib/velo-training/pseudo_label.py` | Top-down pseudo-label pipeline with confidence gate + kinetic-chain check |
| `lib/velo-training/gatekeeper.py` | MLLM data-quality gate (Gemini 2.5 Flash-Lite, Set-of-Mark skeleton plausibility) |
| `lib/velo-training/velo_loss.py` | Kinetic-chain OKS-sigma weighting; pre-wired for velo19 racket kpts (idx 17/18) |
| `lib/velo-training/build_hardval_gold.py` | Ranks hard frames by stock-vs-teacher disagreement; builds Label Studio import task |
| `lib/velo-training/export_hardval_gold.py` | Exports human-corrected labels from Label Studio SQLite |
| `lib/velo-training/data/merged/data.yaml` | COCO-17 dataset config: 1,596 train / 200 val / 198 test, `nc=1 tennis_player`, corrected `flip_idx` |
| `lib/velo-training/data/hardval_gold/PROVENANCE.md` | Hardval_gold construction, leakage attestation, label semantics, human signoff |
| `lib/velo-training/docs/ITERATION-LOG.md` | Chronological finetune experiment log; stock model zoo table; strategic redirect |
| `lib/velo-training/docs/FRONTIER-ROADMAP.md` | Full landscape audit: 9 dimensions, licensing table, per-dimension recommendations |

---

*Prepared 2026-06-04. Branch: `feature-nn`. Do not cite the "34.4→76.0" structured-context figure or the "98% coaching accuracy" figure — both have been explicitly removed from all internal documentation as unverifiable. Best honest tennis-LLM agreement ceiling: ~76% (SportsGPT). Best honest unbiased stock model on hardval_gold: `yolo11l` at 0.893/0.602.*
