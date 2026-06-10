# CODEX — START HERE (Velo Tier-1 pose fine-tune)

You are an autonomous engineer in the **VeloApp** repo, branch **`feature-nn`**, working dir **`lib/velo-training/`**.
Your pose model is *served* by `lib/velo-engine/` via the `YOLO_WEIGHTS` env var.

## 1. Read first (in order)
1. THIS file (runbook)
2. `lib/velo-engine/docs/CODEX-SPEC-3-finetune-autoannotation.md` (full spec)
3. `lib/velo-engine/docs/CODEX-RESEARCH.md` and `REVISED-ARCH.md` (context)

## 2. Hard guardrails
- **Git: `git pull` ok, NEVER push.** No `git stash`/`merge`/`rebase`. Prepare the diff only.
- Secrets in repo-root `.env` — read by NAME, never print/commit.
- Python 3.11. (Engine venv at `lib/velo-engine/.venv` already has ultralytics/torch/cv2/openai/modal.)
- **Modal CLI ignores `.env`** — you MUST export tokens first (see Step 4) or every `modal` command says "Token missing".

## 3. Already built & VERIFIED LIVE (2026-06-02) — extend, do NOT rebuild
- `prepare_dataset.py` → COCO-17 leakage-safe `data/merged` (1596/200/198) + correct `data.yaml`. ✅
- `eval_pose.py` → honest OKS baseline. Measured stock `yolo11s-pose`: **pose_mAP50=0.959 (easy val) but only 0.406 on
  hard footage** → real fine-tune headroom is in occlusion/coach+student/blur, not easy frames.
- `pseudo_label.py` → top-down-pose COCO-17 pseudo-labels, conf-gated. ✅
- `gatekeeper.py` → **LIVE on Gemini 2.5 Flash-Lite** (provider/model/key already in `.env`; verified real verdicts).
  DeepSeek is text-only (rejects images) — do NOT use it for the gate.
- `train.py` (Modal A10G + local), `velo_loss.py` (kinetic-chain OKS-sigma, verified). 
- **Modal**: authed + **A10G GPU launches** ($30 credit, no card needed). `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` in `.env`.

## 4. Objective (do NOT chase "98%")
"98% suggestion accuracy" is not a real metric (it traces to box mAP@0.5≈98.87). Produce a pose model that **BEATS
stock `yolo11s-pose` on a HUMAN-VERIFIED hard held-out set** by OKS `pose_mAP50` (≥0.75) AND `pose_mAP50-95`. Ship only
if it beats stock there; else keep stock and say so (valid result).

### ⚠ Eval must not be circular
The current `data/hardval` GT was made by `yolo11x` (SILVER). If you train on `yolo11x` pseudo-labels and then score
against `yolo11x`-labeled hardval, a fine-tune "wins" by distillation, not accuracy. **The ship gate requires a
HUMAN-verified `data/hardval_gold/`, labeled by a source NOT used in training.**

## 5. Do, in order (gate each)
1. `python prepare_dataset.py` → `python eval_pose.py --data data/merged/data.yaml` — confirm stock ≈0.959.
2. **Build `data/hardval_gold/` for human signoff:** from `data/hardval`, pick the ~60 frames where `yolo11s` and
   `yolo11x` keypoints DISAGREE most; render numbered COCO overlays + a CVAT/Label-Studio task + README legend. Mark
   PENDING in PROVENANCE.md; do NOT compute ship metrics on it until a human signs off. (Ask the human to verify.)
3. **Scale `data/merged/train`:** `pseudo_label.py --weights yolo11x-pose.pt` on hard footage (in-repo coach+student
   clip + Mendeley DOI 10.17632/nv3rpsxhhk.1), then triage the review queue LIVE:
   `python gatekeeper.py --review-dir data/pseudo/review` (Gemini). Never let hardval clips leak into train.
4. **Fine-tune on Modal A10G** (export tokens first — CLI ignores .env):
   ```
   cd lib/velo-training
   set -a; source <(grep -E '^MODAL_TOKEN_(ID|SECRET)=' ../../.env); set +a
   ../velo-engine/.venv/bin/modal volume put velo-pose-data data/merged /merged
   ../velo-engine/.venv/bin/modal run train.py --epochs 100   # 2-stage recipe SPEC-3 §6a; always baseline
   ```
   (Local fallback: `python train.py --local --data data/merged/data.yaml --epochs 100 --baseline`.)
5. **Evaluate** on clean val AND `data/hardval_gold` (once human-verified):
   `python eval_pose.py --data data/hardval_gold/data.yaml --finetuned <best.pt> --split test`. Ship only if it beats
   stock on the gold set.
6. **Integrate + verify:** `export YOLO_WEIGHTS=$(pwd)/runs/velo-pose/weights/best.pt`; `cd ../velo-engine &&
   .venv/bin/python verify_engine.py` (telemetry must validate; overlays land on the body).

## 6. Deliverables (prepare diff — DO NOT push)
`compare_report.md` (stock vs fine-tune on clean val AND gold hardval, SHIP/NO-SHIP, 4–6 overlays incl. occluded,
honest target table); `data/hardval_gold` provenance + leakage attestation; `best.pt` path + `YOLO_WEIGHTS` line +
`verify_engine.py` output. If it doesn't beat stock on gold hardval, recommend keeping stock.
