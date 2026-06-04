# CODEX SPEC 3 — Tier-1 Pose Fine-Tune, Auto-Annotation & Honest Evaluation

**Owner:** NN/vision lead (Eshaan) → autonomous handoff to Codex.
**Date:** 2026-06-01. **Branch:** `feature-nn`. **Deadline:** ~2026-06-07–11 (Somnia Agentathon).
**Read first:** [CODEX-RESEARCH.md](CODEX-RESEARCH.md) §4–5, [REVISED-ARCH.md](REVISED-ARCH.md).
**Code lives in:** `lib/velo-training/` (produces a `best.pt`); the engine in `lib/velo-engine/` *serves* it via `YOLO_WEIGHTS`.

> **Git rule (hard):** you may `pull` but **NEVER push**, and do not run `git stash`/`merge`/`rebase`.
> Work on disk only. Secrets are in repo-root `.env` (`ROBOTFLOW_PRIVATE_API_KEY`, `GEMINI_API_KEY`, …) —
> reference by name, never print or commit them.

---

## 0. TL;DR — read this before anything

This job fine-tunes the **deterministic Tier-1 pose model** that converts tennis video → 17 COCO keypoints,
which `lib/velo-engine` turns into joint-angle telemetry for the LLM coach. **The geometry is plain NumPy and
already done; your job is to make the *keypoints* better on real tennis footage and to prove it honestly.**

**The accuracy target has been corrected (this is mandatory reading).** "98%+ accuracy in coaching suggestions"
is **not a real or achievable single metric** — five independent verifications + the team transcript confirm it.
The "98%" traces to the Roboflow dataset's **box mAP@0.5 ≈ 98.87**, an object-detection number on an easy
in-distribution split. Use this **honest decomposed target set** instead:

| Layer | Metric | Realistic target | Notes |
|---|---|---|---|
| Player/stroke box detection | box mAP@0.5 (in-distribution val) | 95–98% | This is the *true* "98%", stated honestly. Not coaching accuracy. |
| **Pose keypoints** | **OKS `pose_mAP50`** on a **HARD** held-out tennis val | **≥0.75 go/no-go**, stretch 0.80–0.85 | The number that drives angle quality. |
| Pose keypoints (precision) | `pose_mAP50-95` | beat stock baseline (**0.515**, measured) | Where the fine-tune actually earns its keep. |
| Stroke-type classification | accuracy | 85–95% controlled / 70–85% real | Engine derives this from kinematics today. |
| **End-to-end coaching suggestion** | expert agreement | **70–80%** | Best *published* system ≈76% (SportsGPT, Dec 2025); **none exceed ~80%**. |

**Surprising measured fact that shapes scope:** stock COCO-pretrained `yolo11s-pose` **already scores
`pose_mAP50 = 0.959`, `pose_mAP50-95 = 0.515`** on the clean Roboflow tennis val set (measured 2026-06-01 with
`eval_pose.py`). So on *easy* footage there is little headroom and **stock already carries the demo**. The fine-tune's
honest value is (a) **precision** (mAP50-95) and (b) **hard cases the clean dataset lacks** — occlusion, coach+student,
motion blur, side angles. **Therefore the data work (auto-annotation of harder footage) matters more than the
training recipe.** Always evaluate on a HARD held-out set, never only the clean Roboflow val.

---

## 1. Where this fits (the seam — do not break it)

```
video → [Tier-1: YOLO11s-pose + NumPy geometry] → TennisTelemetry v2 → [Tier-2 LLM coach] → on-chain report
                     ▲ you improve this net
```

- The engine loads weights from env `YOLO_WEIGHTS` (`lib/velo-engine/src/yolo_analyze.py:_DEFAULT_WEIGHTS`).
  **Shipping a fine-tune = point `YOLO_WEIGHTS=/abs/path/best.pt`.** No engine code change needed for a 17-kpt model.
- Engine assumes **COCO-17** (`COCO17_NAMES`, indices 0–16). Any model you ship MUST output COCO-17 in that order.
- The schema is already pre-wired for the P2 upgrade: `KeypointSpec.indexing` accepts `"velo19"` and
  `EngineInfo.racket_keypoints` exists (`lib/velo-engine/src/models.py`). See §6d.
- **Verify after shipping:** `cd lib/velo-engine && .venv/bin/python verify_engine.py` must still emit schema-valid
  telemetry with the new weights (set `YOLO_WEIGHTS` first).

---

## 2. Verified ground truth (measured 2026-06-01 — trust these over web sources)

1. **Roboflow `coco` export for gdv is DEAD** (returns a 257-byte `NoSuchKey` XML → `BadZipFile`); the SDK cannot
   regenerate it. **The `yolov8` export WORKS.** `prepare_dataset.py` already uses yolov8.
2. **Every tennis-pose Roboflow set (gdv / degree / tennis-0ytvl) uses the SAME 18-kpt skeleton =
   COCO-17 + a `neck` point at index 17.** Indices 0–16 are *exactly* canonical COCO-17. Confirmed by reading the
   COCO category `keypoints` list directly. → Drop index 17 → exact COCO-17 (done in `prepare_dataset.py`).
3. **Keep 17 keypoints, not 18.** Ultralytics only applies correct COCO OKS sigmas for `kpt_shape=[17,*]`; any other
   count falls back to uniform `1/N` → metrics become non-comparable to COCO baselines.
4. **The exports ship `flip_idx` as identity `[0..17]` — WRONG.** Horizontal-flip aug would not swap L/R joints and
   would corrupt labels. Correct COCO value (already written by `prepare_dataset.py`):
   `[0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15]`.
5. **Heavy overlap / leakage risk.** gdv/degree/tennis-action all derive from the same ~2k base, Roboflow-augmented.
   Naive merge + random split puts augmented copies of one base image in both train and val → **fake-high val mAP.**
   `prepare_dataset.py` defaults to ONE source's official Roboflow split; extras append to **train only**.
6. **Dataset sizes (API-verified):** `tennis-0ytvl/tennis-action v3` (~2k, working, the primary),
   `degree/tennis-pose-detection v2` (~10.4k), `degree/tennis-pose-estimation-erpft v1` (~4.8k), `gdv …inuk5 v4` (~2k).
7. **Cleaner citable seed:** Mendeley "Tennis Player Actions" (DOI `10.17632/nv3rpsxhhk.1`, 2k imgs, 4 strokes,
   same COCO-18, **CC BY 4.0**) — manually annotated, better provenance than the Roboflow mirrors. Fold in via §5b.
8. **GroundingDINO/SAM output boxes/masks, NOT keypoints** (X-Pose: "Grounding-DINO fails to localize fine-grained
   keypoints"); MLLMs ~50% on spatial-pose → cannot emit coordinates. The auto-annotation core is a **top-down pose
   model**, not GroundingDINO. See §5b.

---

## 3. What is ALREADY built & verified in `lib/velo-training/` (extend, don't rebuild)

All of the following were created and **run successfully** on CPU (Apple M2) on 2026-06-01:

| File | Status | What it does |
|---|---|---|
| `prepare_dataset.py` | ✅ runs | Downloads working **yolov8** exports, drops neck→COCO-17, fixes `flip_idx`, collapses to `nc=1 tennis_player`, builds leakage-safe `data/merged/` (1596/200/198) + `data.yaml`. `--merge-extra` adds the big sets to train only. `--inspect-only` prints the skeleton verdict. |
| `eval_pose.py` | ✅ runs | Honest baseline-vs-fine-tune harness. **Measured stock baseline: `pose_mAP50=0.959`, `pose_mAP50-95=0.515`, `box_mAP50=0.786`.** Prints SHIP/NO-SHIP verdict + go/no-go gate. |
| `pseudo_label.py` | ✅ runs | The CORRECT auto-annotation core: top-down pose model → COCO-17 pseudo-labels, conf-gated (auto-accept vs review queue). Smoke: 10/12 auto-accepted. |
| `gatekeeper.py` | ✅ runs (mock) | Provider-agnostic MLLM data-quality gate (DeepSeek V4 Flash / Gemini 2.5 Flash-Lite via env), Set-of-Mark skeleton plausibility check; triages `pseudo_label`'s review queue. Add a multimodal key + `pip install openai` to leave MOCK mode. |
| `train.py` | ✅ imports | Modal A10G + local CLI trainer; `--baseline` honesty gate; optional `--weighted-loss`. |
| `velo_loss.py` | ✅ patches on ultralytics 8.3.40 | Kinetic-chain OKS-sigma weighting (wrist sigma 1.0→0.45 = tighter). See §6b for the subclass upgrade. |

`data/merged/` already contains a valid COCO-17 dataset. `data/raw/` holds the downloaded yolov8 sets.
**The dead `data/raw/gdv-primary/roboflow.zip` (NoSuchKey XML) can be deleted.**

---

## 4. Build order (do these in sequence; each has a gate)

### STEP 1 — Baseline & dataset (DONE; re-run to confirm in your env)
```bash
cd lib/velo-training
python prepare_dataset.py                 # builds data/merged (COCO-17, leakage-safe)
python eval_pose.py --data data/merged/data.yaml --split val   # confirm stock ≈ 0.959 pose_mAP50
```
**Gate:** baseline reproduces (`pose_mAP50 ≈ 0.95` on this easy val). If your number is wildly different, stop and
inspect the label conversion before training.

### STEP 2 — Build a HARD evaluation set (the most important step)
The clean Roboflow val is too easy (stock already 0.96). You MUST construct a held-out set that contains the failure
modes Velo faces, or the fine-tune cannot be honestly judged.
- Source hard frames: the in-repo coach+student clip
  `reference-files-eshaan/edg-jjwx-xwy (2026-05-30 08_59 GMT-7).mp4` (occlusion, two people), plus 2–3 Pexels/Pixabay
  side-on + motion-blur clips. Sample frames (`pseudo_label.py --video … --fps 3` extracts frames).
- **Hand-verify** these labels (CVAT, ~100–300 frames). This is the only set that tells the truth. Keep it
  **completely separate** from training (`data/hardval/`), and report all headline numbers on it.

**Gate:** `data/hardval/` exists with ≥100 human-verified COCO-17 frames; `eval_pose.py --split test` (pointed at it)
produces a *lower* stock baseline than 0.96 (proving it actually exercises the hard cases).

### STEP 3 — Scale training data via auto-annotation (§5)
Grow `data/merged/train` with pseudo-labeled hard footage (THETIS frames + raw clips), MLLM/human-gated.

### STEP 4 — Fine-tune (§6)
2-stage freeze→unfreeze on Modal A10G. Always `--baseline`.

### STEP 5 — Evaluate honestly & ship (§7–9)
`eval_pose.py` on BOTH clean val and `data/hardval/`. Ship only if it beats stock on the hard set. Drop `best.pt`
into the engine via `YOLO_WEIGHTS`, re-run `verify_engine.py`, and re-check telemetry sanity.

---

## 5. Data pipeline

### 5a. Clean COCO-17 base — DONE
`prepare_dataset.py` (see §3). For more clean data: `python prepare_dataset.py --merge-extra` (adds ~15k augmented
train images from degree/gdv — train only, val/test stay clean). Watch for diminishing returns (it's still easy data).

### 5b. Auto-annotation of HARD footage (the corrected pipeline)
**Do NOT use GroundingDINO to make keypoints — it only makes boxes.** The buildable chain (verified design):

```
raw tennis video / THETIS clips
   │  (cv2 sample @ 3–5 fps)
   ▼
[Stage 1] person detection: GroundingDINO 'tennis player'  OR  YOLO11x person — gives BOXES
   │
   ▼
[Stage 2] top-down pose model on each crop → 17 COCO keypoints + per-kpt confidence
   │        ↳ pseudo_label.py uses yolo11s-pose. For higher-quality labels, use a STRONGER labeler:
   │          ViTPose-H or RTMPose (MMPose) — they outscore yolo-pose and you are not latency-bound here.
   ▼
[Stage 3] confidence gate (pseudo_label.py): mean kpt-conf ≥ τ AND kinetic-chain joints present
   │        ├─ auto-accept → data/pseudo/{images,labels}
   │        └─ low-conf    → data/pseudo/review  (human/MLLM triage, Stage 4)
   ▼
[Stage 4] MLLM gatekeeper / human review (§5c)  → corrected labels
   ▼
fold into data/merged/train  (NEVER into val/hardval — leakage)
```

Run today:
```bash
python pseudo_label.py --video reference-files-eshaan/<clip>.mp4 --fps 3 --out data/pseudo --conf 0.6
# fold accepted: copy data/pseudo/images/* + labels/* into data/merged/{images,labels}/train
```
**Datasets to pull in (license-aware):**
- Mendeley `10.17632/nv3rpsxhhk.1` (CC BY 4.0, 2k, COCO-18 → drop neck): cleanest labeled supplement.
- THETIS (1,980 RGB clips, 12 strokes; research-only license) — sample RGB frames, pseudo-label, human-review. This is
  the only realistic path to a *large* COCO-17 tennis set with hard poses. Its native skeleton is Kinect-15/20, NOT
  COCO — so use the **frames**, generate COCO-17 via Stage 2, don't use THETIS's own skeleton.
- TenniSet (MIT, temporal event labels only, no skeleton) — for a stroke-timing classifier, not pose.

### 5c. MLLM gatekeeper (cost-effective, but bounded)
MLLMs are reliable as **binary pass/reject filters for obvious defects**, NOT as coordinate generators or subtle-error
judges (O-Bench: large MLLM-vs-human gap). Three-stage filter (all optional, scale to budget):
1. **CLIP pre-filter (free):** reject frames with CLIP cosine < ~0.28 vs "a tennis player in a clear unoccluded pose."
2. **MLLM bulk gate** — **Gemini 2.5 Flash-Lite** (~$0.000026/img; note: 2.0 Flash-Lite DEPRECATED 2026-06-01, use
   2.5) or OpenAI gpt-4o-mini / OpenRouter. **VERIFIED 2026-06-02: DeepSeek's API is TEXT-ONLY — it rejects
   `image_url`, so it canNOT run the vision gate** (a DeepSeek key only powers text roles). Structured YES/NO —
   player visible? sharp enough to see joints? exactly one foreground player? (`gatekeeper.py` Stage 1.)
3. **GPT-4o-mini Set-of-Mark skeleton check** (~$0.00042/img): render the predicted skeleton with **numbered joints**
   on the image, ask plausibility per joint (wrists near hands not legs; ankles at ground; no impossible crossings).
   Catches gross corruption (arm↔racket swap). **15–30% false-negative on subtle swaps → FAIL routes to human, never
   auto-delete.** Human spot-check 2–5% of MLLM-passed frames.
This implements the user's "MLLM observer" vision, correctly scoped (validate/flag, not annotate). **Implemented in
`lib/velo-training/gatekeeper.py`** — provider-agnostic (OpenAI-compatible chat+image); runs in a deterministic MOCK
mode offline. **Provider reality (verified 2026-06-02): DeepSeek's API (deepseek-v4-flash/pro) is TEXT-ONLY — it
rejects `image_url`, so it cannot run the vision gate.** Use **Gemini 2.5 Flash-Lite**
(`GATEKEEPER_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `GATEKEEPER_MODEL=gemini-2.5-flash-lite`)
or OpenAI gpt-4o-mini / OpenRouter. Add the key as `GATEKEEPER_API_KEY` + `pip install openai` to go live; a DeepSeek
key powers text roles only. The gatekeeper is **optional** — the free pose-confidence gate + human spot-check cover the essentials.
arXiv:2507.02904 shows structured-context injection lifts tennis-LLM scores 34.4→76.0 — i.e. the **telemetry-first
architecture is the real win**, the MLLM is a filter, not the brain.

> **[CORRECTION 2026-06-04]** The "34.4→76.0" figure could NOT be verified in arXiv:2507.02904 or any source — an adversarial multi-agent review flagged it as likely fabricated. DO NOT CITE it. The honest, defensible claim is directional only: structured / telemetry-first context injection improves coaching-LLM output quality; the exact magnitude is unverified. (Best *verified* published tennis-LLM expert-agreement remains modest — treat any specific percentage with skepticism and cite the primary source before use.)

### 5d. Leakage rule (non-negotiable)
Split by **base image / source clip**, never by augmented frame. `hardval` frames must come from clips that contribute
**zero** frames to train. Report this split explicitly in the PR.

---

## 6. Training

### 6a. Recipe
- **Checkpoint: `yolo11s-pose.pt`** (matches the engine's CPU-serving size; the engine loads whatever `YOLO_WEIGHTS`
  points to, so `s` keeps Koyeb lean). Try `yolo11m-pose` only if `s` underperforms on `hardval`.
- 2-stage (`train.py` supports both via flags; or call directly):
  - Stage 1 (adapt head): `epochs=30, freeze=10, imgsz=640, batch=16, optimizer=AdamW, lr0=0.001, mosaic=0.5,
    close_mosaic=5, patience=15`.
  - Stage 2 (full): from stage-1 `best.pt`, `epochs=70, freeze=0, lr0=0.0001, lrf=0.01, cos_lr=True, mosaic=0.5,
    patience=20`.
- `flip_idx` is already correct in `data.yaml`. If you ever add an asymmetric (handed) keypoint, set `fliplr=0`.
- `mosaic=1.0` hurts on <2k images; keep ≤0.5 until the set is larger.

### 6b. Loss weighting (`velo_loss.py`) — P2, ablate before trusting
- The kinetic chain (shoulder/elbow/wrist/hip) drives the coaching angles, so weight it harder via **OKS sigma**:
  smaller sigma = stricter penalty. `velo_loss.py` already does this (verified: wrist sigma 1.0→0.45 on ultralytics
  8.3.40). Enable with `train.py --weighted-loss`.
- **Robustness upgrade:** the current approach **monkeypatches** `KeypointLoss.__init__` — fine on the pinned
  `ultralytics==8.3.40`, but fragile across versions. The forward-compatible path is to **subclass `v8PoseLoss`**
  (override `PoseModel.init_criterion()` → `KeypointLoss(sigmas=custom)`, then `PoseTrainer.get_model()`). Implement
  this if you bump ultralytics. Sport-tuned 17-sigma vector (lower hitting chain):
  `[.026,.025,.025,.035,.035,.050,.050,.040,.040,.030,.030,.107,.107,.087,.087,.089,.089]`.
- Optional bone-length-consistency term (`L_bone = λ·mean|‖pred_bone‖−‖gt_bone‖|`, λ≈0.1) — only if ablation on
  `hardval` shows it helps. Do **not** add 2D joint-angle-limit loss (ambiguous under projection without a 3D head).
- **Honesty:** all loss tweaks are unvalidated transfers; A/B them on `hardval` and keep them only if they win.

### 6c. Compute (no team GPU)
- **Modal A10G — recommended.** ~$1.10/hr, ~5–7h for 100 epochs on ~3.5k imgs ≈ **$5.50–7.70, inside the $30 free
  Starter credit.** `train.py` has the Modal entrypoint (`modal run train.py --epochs 100`). Upload `data/merged`:
  `modal volume put velo-pose-data data/merged /merged`.
- Fallbacks: Colab free T4 (resume across 2 sessions, $0), RunPod RTX 4090 (~$1 cash), Ultralytics Platform ($25 credit,
  no-code).

### 6d. P2 — racket keypoints (velo19) → true wrist-snap
The engine schema already supports `indexing="velo19"` and `racketKeypoints=true`. To unlock true wrist-snap + racket
path: annotate `racket_butt` (idx 17) + `racket_tip` (idx 18) on a subset (CVAT), train a 19-kpt model, set
`kpt_shape=[19,3]` with a custom 19-sigma vector (subclass path — uniform 1/N otherwise), and update the engine's
`COCO17_NAMES`/`KeypointSpec` to velo19 + `_extract_joint_angles` to use the racket vector for real wrist flexion.
**This is the single highest-value model upgrade** (fixes G8) but is post-MVP — only if time remains.

---

## 7. Active-learning loop (OPTIONAL, post-MVP — honest version)

The "closed-loop steering that converges 24–50% faster" claim is **marketing — no primary source supports it** (real
active-learning gains are *annotation efficiency*, single-digit to low-double-digit %, and are seed-sensitive per
CDALBench). Build it only if MVP is done, and measure against a random-selection baseline with many seeds before
claiming anything. Buildable, evidenced shape:
1. **Dual-threshold pseudo-labeling** (Efficient-Teacher style): per-epoch τ₁/τ₂ from the confidence distribution;
   route the τ₁–τ₂ band to human review. **For keypoints, route on OKS / dual-model disagreement, NOT raw confidence**
   (heatmap confidence ≠ spatial accuracy).
2. **LLM augmentation controller** every N=5 epochs: feed (val OKS, epoch, prior policy); it returns a new policy from a
   **bounded** set (`mosaic, mixup, degrees, scale, hsv_*, fliplr`) with explicit min/max — never free-form transforms.
3. **Human-review queue** with a fixed weekly budget (Click-Pose-style correction).
Ultralytics has no native AL hooks — wrap the training loop externally.

---

## 8. Evaluation & acceptance gates

Run `eval_pose.py` on **both** splits and report both:
```bash
python eval_pose.py --data data/merged/data.yaml --finetuned runs/velo-pose/weights/best.pt --split val
python eval_pose.py --data data/hardval/data.yaml --finetuned runs/velo-pose/weights/best.pt --split test
```
**Ship the fine-tune ONLY if it beats stock on `hardval` (both `pose_mAP50` and `pose_mAP50-95`).** On the easy clean
val, ~parity is expected (stock is already 0.96) — that is NOT a reason to ship; the hard set decides.

Gates:
1. `pose_mAP50` on `hardval` **> stock** and **≥ 0.75**.
2. `pose_mAP50-95` on `hardval` **> stock** (precision is the main win).
3. No regression on clean val (≥ stock − 0.01).
4. Engine re-verify: `verify_engine.py` with `YOLO_WEIGHTS=best.pt` → schema-valid telemetry, keypoints land on the body
   in overlays (eyeball 5–6 frames incl. an occluded one).
5. (If Tier-2 wired) end-to-end coaching-suggestion eval: 20–30 clips rated by a tennis-savvy human against a rubric;
   target **70–80% agreement**. Report the number honestly; do NOT claim 98%.

---

## 9. Engine integration & verification

```bash
# point the engine at the fine-tune and re-verify end-to-end
export YOLO_WEIGHTS=$(pwd)/runs/velo-pose/weights/best.pt
cd ../velo-engine && .venv/bin/python verify_engine.py          # schema-valid v2 telemetry?
VISION_ENGINE=yolo uvicorn src.main:app --port 8000             # boot; /healthz engine=yolo
python test_engine.py --overlay "<a hard clip URL>"             # overlays land on the body?
```
No engine code changes for a 17-kpt model. For velo19 (§6d), update `COCO17_NAMES`, `KeypointSpec`, and
`_extract_joint_angles` together.

---

## 10. Deliverables (PR description — remember: NO push; prepare the branch/diff for Eshaan to push)

1. `compare_report.md`: stock vs fine-tune on **clean val AND hardval**, the SHIP/NO-SHIP verdict, 4–6 overlay frames
   (incl. occluded), and the honest target table (§0) filled with your measured numbers.
2. `data/hardval/` description: source clips, frame counts, who/what verified the labels, leakage attestation.
3. `best.pt` location + the exact `YOLO_WEIGHTS` line, and `verify_engine.py` output proving telemetry still validates.
4. If you built §5c/§7: the gatekeeper/loop code + an honesty note on what was and was NOT ablated.
5. State plainly if the fine-tune did **not** beat stock on hardval — that is a valid, useful result (keep stock).

---

## 11. Scope guidance (hackathon-honest)

- **Minimum win:** reproduce the baseline, build `hardval`, run one Modal fine-tune, report the honest comparison.
  If stock wins on hardval, **ship stock** and pitch the deterministic, auditable pipeline (that is the real story).
- **Strong win:** auto-annotate THETIS/raw hard footage (§5b) so the fine-tune actually beats stock on occlusion, +
  the MLLM gatekeeper (§5c) as the "intelligent observer" demo.
- **Stretch:** velo19 racket keypoints (§6d) for true wrist-snap; active-learning loop (§7).
- **Pitch line you can say truthfully:** *"Our detector hits ~98% mAP@0.5 on tennis stroke detection; our pose stage
  beats the COCO baseline on occluded footage; the deterministic engine converts that to auditable joint angles, and
  the LLM coach reasons on numbers — matching the best-published coaching-advice agreement (~76%)."* Do not say "98%
  accurate coaching."

## 12. Citations (verified to exist, 2026-06-01)
arXiv:2507.02906 (tennis doubles analytics — GroundingDINO+YOLO-Pose), 2507.02904 (MLLMs for tennis video; structured
context 34.4→76.0), 2303.05499 (GroundingDINO), 2310.08530 (X-Pose; GD can't do keypoints), 2302.07577 (Efficient
Teacher), 2410.13453 (LLM augmentation controller), 2402.01881 (AgentHPO), 2408.00426 (CDALBench), 2106.04274 (wKCS),
PMC13075223 (CDO-POSE; efficiency, NOT biomech constraints), Mendeley 10.17632/nv3rpsxhhk.1 (tennis keypoints, CC BY 4.0).

---

## 13. Codex kickoff prompt (paste verbatim)

> You are extending `lib/velo-training/` in the VeloApp repo (branch `feature-nn`). Read
> `lib/velo-engine/docs/CODEX-SPEC-3-finetune-autoannotation.md` fully, then
> `CODEX-RESEARCH.md` and `REVISED-ARCH.md`. **Constraints: you may `git pull` but NEVER `git push`, and never run
> `git stash`/`merge`/`rebase`. Never print or commit secrets (read `ROBOTFLOW_PRIVATE_API_KEY`, `GEMINI_API_KEY` from
> repo-root `.env`).** Use a Python 3.11 env.
>
> Goal: produce a Tier-1 tennis pose model that **beats stock `yolo11s-pose` on a HARD, human-verified held-out set**
> (occlusion / coach+student / motion blur), measured by OKS `pose_mAP50` and `pose_mAP50-95` via `eval_pose.py`.
> Do NOT chase "98% suggestion accuracy" — it is not real; use the decomposed targets in SPEC-3 §0.
>
> Do, in order, gating on each step:
> 1. `python prepare_dataset.py` then `python eval_pose.py --data data/merged/data.yaml` — confirm the stock baseline
>    reproduces (~0.959 pose_mAP50 on the easy val).
> 2. Build `data/hardval/` (≥100 human-verified COCO-17 frames from the in-repo coach+student clip + 2–3 hard web
>    clips). Keep it leakage-free.
> 3. Scale `data/merged/train` via `pseudo_label.py` on hard footage (THETIS frames / raw clips) + the Mendeley CC BY
>    seed; gate with the §5c MLLM/human filter. Never let hardval clips leak into train.
> 4. Fine-tune on Modal A10G (2-stage recipe, `train.py`, always `--baseline`). Optionally `--weighted-loss`.
> 5. `eval_pose.py` on BOTH clean val and hardval. Ship only if it beats stock on hardval. Point the engine at
>    `best.pt` via `YOLO_WEIGHTS`, run `lib/velo-engine/verify_engine.py`, and confirm schema-valid telemetry.
> 6. Write `compare_report.md` (§10) with honest numbers + overlays. If the fine-tune does not beat stock on hardval,
>    say so and recommend keeping stock. Prepare the diff for review — **do not push.**
