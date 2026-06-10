# velo-training

Tier-1 pose model: dataset prep + fine-tune for the deterministic tennis engine.
Kept separate from the FastAPI runtime (`lib/velo-engine`) — this dir only
*produces* a weights file; the engine *serves* it via `YOLO_WEIGHTS`.

**Full handoff spec:** [`../velo-engine/docs/CODEX-SPEC-3-finetune-autoannotation.md`](../velo-engine/docs/CODEX-SPEC-3-finetune-autoannotation.md).
Read it before training — it carries the corrected accuracy targets, the verified
dataset facts, and the auto-annotation pipeline.

## Phases

| Phase | What | Status |
|-------|------|--------|
| **P0** | stock `yolo11s-pose` in velo-engine. No training. | ✅ done |
| **P1** | Fine-tune COCO-17 on tennis data, **beat stock on a HARD held-out set**. | this dir |
| **P2** | Racket butt/tip keypoints (velo19) + kinetic-chain loss → true wrist-snap. | `velo_loss.py`, SPEC-3 §6d |

## Verified facts (2026-06-01 — measured, not assumed)

- Roboflow `coco` export is **dead** (NoSuchKey); the **`yolov8`** export works. `prepare_dataset.py` uses yolov8.
- The tennis-pose sets are **COCO-17 + a `neck` point (18 kpts)**. We drop the neck → exact COCO-17 (drop-in for the engine).
- Datasets ship an **identity `flip_idx` (wrong)**; `prepare_dataset.py` writes the correct COCO L/R swap.
- **Stock `yolo11s-pose` already scores `pose_mAP50 = 0.959` / `mAP50-95 = 0.515`** on the clean Roboflow val
  (`eval_pose.py`). So the fine-tune's real value is **precision + hard cases (occlusion / coach+student / blur)** —
  evaluate on a HARD held-out set, not just this easy val.

## Scripts

| Script | What |
|---|---|
| `prepare_dataset.py` | Download yolov8 → COCO-17, fix flip_idx, leakage-safe `data/merged` + `data.yaml`. `--merge-extra` for more train data. `--inspect-only` for the skeleton verdict. |
| `eval_pose.py` | Honest baseline-vs-fine-tune OKS mAP + SHIP/NO-SHIP verdict. |
| `pseudo_label.py` | Auto-annotation core: top-down pose → COCO-17 pseudo-labels, conf-gated (auto vs review). `--video` or `--images`. |
| `train.py` | Modal A10G + local trainer; `--baseline` honesty gate; `--weighted-loss` (P2). |
| `velo_loss.py` | Kinetic-chain OKS-sigma weighting (verified on ultralytics 8.3.40). |

## Quickstart

⚠️ **Python 3.11** (matches the engine venv; 3.13 forces a numpy source-build). Roboflow key auto-read from repo-root `.env`.

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt            # ultralytics, roboflow, pyyaml, (modal)

python prepare_dataset.py                  # build data/merged (COCO-17, leakage-safe)
python eval_pose.py --data data/merged/data.yaml          # confirm stock baseline ≈ 0.959

# scale with hard footage (the part that actually helps):
python pseudo_label.py --video ../../reference-files-eshaan/<clip>.mp4 --fps 3 --out data/pseudo

# train (Modal A10G ≈ $6, within free credit) — always --baseline:
modal volume put velo-pose-data data/merged /merged && modal run train.py --epochs 100
#   or local/Colab:  python train.py --local --data data/merged/data.yaml --epochs 100 --baseline

python eval_pose.py --data data/hardval/data.yaml --finetuned runs/velo-pose/weights/best.pt --split test
```

Best weights → `runs/velo-pose/weights/best.pt`. Ship: `YOLO_WEIGHTS=/abs/path/best.pt` in `lib/velo-engine/.env`,
then re-run `lib/velo-engine/verify_engine.py`.

## Honesty rule

Always `--baseline`, and judge on a **HARD held-out set** (stock already wins on easy data). Ship the fine-tune only
if it beats stock on hard footage — that before/after delta is your strongest demo slide. Shipping stock is a valid
outcome; the deterministic, auditable pipeline is the real story.

## Git

`pull` is fine; **never push** from automation. Don't run `git stash`/`merge`/`rebase`. Secrets stay in `.env`.
