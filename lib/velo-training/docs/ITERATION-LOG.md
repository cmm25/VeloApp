# Velo Tier-1 Pose — Model Iteration Log

Living log of the autonomous finetune-iteration loop. Goal: a tennis pose model that beats stock `yolo11s-pose` on the HARD held-out set `hardval_gold`, en route to the best open-source tennis analysis system.

## The gate (must beat BOTH to ship)
- Stock `yolo11s-pose` on `hardval_gold/test`: **pose_mAP50 = 0.762**, **pose_mAP50-95 = 0.466**, box_mAP50 = 0.966
- Stock on easy clean val (reference): pose_mAP50 = 0.959, mAP50-95 = 0.515
- Ship only if a finetune beats BOTH 0.762 AND 0.466 on hardval_gold. Easy-val parity is NOT a ship reason.

## Model-allocation policy (Eshaan, 2026-06-04)
- Opus = research + heavy thinking. Sonnet = execution (run/eval/parse logs). Haiku = writing docs.

## Key environment facts
- Training runs on Modal A10G ($1.10/hr; each 2-stage run so far ~$0.50, ~20-25 min). Budget authority ~$40.
- Data + weights live on Modal volume `velo-pose-data`. COCO-pose replay subset (3000 train + 400 val imgs) cached at `/vol/coco_replay`.
- Engine serves pose on CPU (Koyeb) — model size/latency matters for the shipped model.
- numpy MUST be pinned <2 in Modal images (ultralytics 8.3.40 uses np.trapz, removed in numpy 2.0).

## Experiments

| ID | Config | hardval pose_mAP50 | hardval mAP50-95 | Verdict | Notes |
|----|--------|--------------------|--------------------|---------|-------|
| stock | baseline yolo11s-pose (COCO-pretrained) | 0.762 | 0.466 | — | the bar to beat |
| #1 | naive finetune on current ~1610 mostly-easy tennis imgs, 2-stage 30+70, select on easy val | 0.149 | 0.091 | ❌ CATASTROPHIC regression | overfit easy (easy-val mAP50-95 0.94), collapsed on hard cases = catastrophic forgetting. Cost ~$0.50 |
| A1 | yolo11s + 3k COCO-person replay + 2-stage(20+40), select on diverse (tennis+COCO) val | 0.773 | 0.396 | ❌ NO-SHIP | Replay FIXED the #1 catastrophic collapse (0.149→0.773). Edges stock on mAP50 (0.773 vs 0.762) but REGRESSES on fine precision mAP50-95 (0.396 vs stock 0.466). Still overfits easy (easy-val mAP50-95 0.90). Lever: add HARD training data (STEP 3). |
| C1 | yolo11m-pose (2x capacity) + 3k COCO replay + 22 hard pseudo-frames + 2-stage(20+40) | 0.756 | 0.379 | ❌ NO-SHIP | Worse than A1 AND stock on BOTH metrics. Doubling capacity did NOT help hard-case precision (0.379 vs A1 0.396 vs stock 0.466). Confirms: bottleneck is DATA, not model capacity. |

**A1 takeaway:** COCO-replay + diverse-val selection is now the safe finetune recipe (no collapse), but matching/beating stock on hard-case PRECISION (mAP50-95) requires hard training examples the current easy data lacks. Next: STEP 3 pseudo-labeled hard footage.

**C1 takeaway:** 3 finetunes now all regress on hard-case precision (mAP50-95: stock 0.466 → A1 0.396 → C1 0.379) while acing easy-val — finetuning on easy data narrows the model away from stock's COCO robustness. Pivot: evaluate the stock model zoo (a stronger stock base like yolo26s may beat yolo11s on hard cases with zero finetune-narrowing).

## Roadmap / next actions
- Eval A1 on hardval_gold (did replay recover toward/past stock?).
- B1: try `yolo26s-pose` + replay (RLE keypoint head, helps occlusion, lower CPU latency) — verify ultralytics supports it without breaking the numpy<2 pin first.
- STEP 3 (the real lever to BEAT stock, per research): pseudo-label more HARD footage (hard tennis clips that are NOT hardval sources 869/873/876/877) with a strong teacher + the live Gemini gatekeeper, human-verify, add to train. No external academic dataset fills the hard-case gap — only pseudo-labeling hard footage does.
- Then finetune on tennis + hard-pseudo-labels + COCO replay; iterate until it robustly beats stock or hits diminishing returns. If nothing honestly beats stock, keep stock (it is already a strong model) and ship the deterministic pipeline.

## Honest constraints
- 2D pose is projection-ambiguous; "98% coaching accuracy" is not real (best published tennis-LLM expert-agreement ~76%).
- hardval_gold is recall-light / kinetic-chain-focused (mean 9.9/17 joints labeled); use it for the RELATIVE stock-vs-finetune decision, not as absolute ground truth.

## Frontier map (2026-06-04) — full detail in FRONTIER-ROADMAP.md

**The open gap Velo owns:** no mature, permissively-licensed, CPU-shippable open-source project takes a single phone clip of one student → auditable per-joint biomechanical telemetry → verifiable LLM coaching. OSS trackers (abdullahtarek, yastrebksv, ArtLabss, TRACE) do ball/court/match-stats only and are mostly unlicensed. Pose→coach papers (Talking Tennis arXiv 2510.03921, ICCV-W 2025, BioCoach) ship no code. Velo's seam is the unshipped thing.

**STRATEGIC REDIRECT:** the "stop-and-stare" wow is NOT more pose finetuning (stock pose is already decent at 0.762). It is the **analysis layer** — especially **kinematic-sequence timing** (proximal→distal peak-velocity ordering: legs→hips→trunk→shoulder→elbow→wrist), which is pure 2D NumPy on the EXISTING keypoints ($0 compute) and is "what makes a biomechanist nod." The pose model is necessary-but-not-sufficient.

**Highest-EV next move (critic, $0 GPU):** ship the CPU-live analysis stack — One-Euro keypoint smoothing (BSD) + kinematic-sequence timing + 5-phase stroke segmentation + a telemetry contract (scale_source / units / clip_quality_gate). Raise engine sample_rate above default 5 for inter-segment lag resolution.

**Stop-and-stare show-stoppers:**
1. Ball tracking via WASB-SBDT (MIT) → true contact frame (caveat: no ONNX, FPS numbers are V100-only — build wrapper + benchmark on CPU first).
2. Court homography (train OWN model on Modal; never ship unlicensed weights) → ITF-meter coords + top-down minimap (the "Hawk-Eye moment").
3. Kinematic-sequence timeline + side-by-side-vs-pro via DTW (dtaidistance, Apache-2.0) — no off-the-shelf component exists; the genuine differentiator.

**Safe-to-adopt OSS (clean licenses):** WASB-SBDT (MIT), ArtLabss/tennis-tracking (Unlicense), roboflow/supervision (MIT), RTMPose/mmpose (Apache-2.0), MotionBERT (Apache-2.0), One-Euro filter (BSD), dtaidistance (Apache-2.0), outlines (Apache-2.0), Mendeley Tennis Player Actions (CC BY 4.0). DO-NOT-VENDOR (no license / all-rights-reserved): abdullahtarek/tennis_analysis, yastrebksv/TennisProject + TennisCourtDetector, hgupt3/TRACE.

**HONESTY FLAGS (correct before any pitch/spec use):**
- "34.4 → 76.0" structured-context lift = **FABRICATED** (not in arXiv:2507.02904 / SportsGPT / anywhere). It appears in CODEX-SPEC-3 §5c and in earlier notes — DO NOT CITE. Honest framing is directional only ("telemetry-first context improves coaching-LLM quality; exact magnitude unverified").
- Do not claim "98% coaching accuracy" (already known-bad).
- BlurBall dataset is TABLE-tennis, not lawn tennis — retrain before adoption.
- WASB CPU speed is unproven (published FPS are V100 GPU).

## STOCK MODEL ZOO on hardval_gold (2026-06-04) — THE KEY FINDING

Finetuning kept regressing on hard-case precision, so we evaluated bigger STOCK (un-finetuned, COCO-pretrained) pose models directly on hardval_gold. Result: bigger stock models dramatically beat yolo11s with ZERO training.

| model | hardval pose_mAP50 | hardval mAP50-95 (precision) | vs yolo11s | rel. CPU latency |
|---|---|---|---|---|
| yolo11s (current) | 0.762 | 0.466 | baseline | 1x (~90ms/frame) |
| yolo26s | 0.748 | 0.481 | +0.015 | ~0.95x (faster) |
| yolo11m | 0.910 | 0.552 | +0.086 | ~2x |
| yolo11l | 0.893 | 0.602 | +0.136 | ~2.7x |
| yolo11x | 0.944 | 0.728* | +0.262* | ~5.4x |
| yolo26m | 0.843 | 0.543 | +0.077 | ~2.4x |

*yolo11x's score is inflated: hardval_gold labels were human-corrected over yolo11x DRAFTS (home advantage). Exclude it from honest ship comparison. The bias-free winners (11m/11l/26s/26m) all still beat yolo11s.

**CONCLUSION:** The lever for a more robust pose model is MODEL SIZE, not finetuning. Finetuning on the available (easy) data narrows the model and regresses hard cases (0.466→0.396→0.379 across #1/A1/C1). The engine analyzes clips as a batch job (~1 min/clip), so it can afford a bigger model. Swapping YOLO_WEIGHTS to yolo11l = +0.136 (+29%) hard-case keypoint precision for $0 and no training. Recommended ship candidates: yolo11l (max precision, batch-OK) or yolo11m (balanced) or yolo26s (free + faster, needs ultralytics 8.4 in engine). Keep finetuning OFF (it hurts). ~$3 of the $40 Modal budget was spent proving this rigorously.
