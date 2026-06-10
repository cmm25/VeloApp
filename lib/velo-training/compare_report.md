# Velo Tier-1 Pose Compare Report

Verdict: **NO-SHIP. Keep stock `yolo11s-pose.pt`.**

The clean validation baseline reproduced, and `data/hardval_gold/` now exists as a
60-frame human-review package selected by stock-vs-strong-teacher disagreement.
It is still **PENDING_HUMAN_VERIFICATION**, so no fine-tune can honestly be shipped.

## Results

| Split | Model | pose_mAP50 | pose_mAP50-95 | box_mAP50 | Notes |
|---|---:|---:|---:|---:|---|
| clean `data/merged` val | stock `yolo11s-pose` | 0.9591 | 0.5148 | 0.7856 | Required Step 1 baseline reproduced. |
| clean `data/merged` val | fine-tune | N/A | N/A | N/A | Not trained; gold hardval is not signed off. |
| `data/hardval_gold` test | stock `yolo11s-pose` | BLOCKED | BLOCKED | BLOCKED | Labels are draft `yolo11x` review hints, not human GT. |
| `data/hardval_gold` test | fine-tune | BLOCKED | BLOCKED | BLOCKED | No ship metric until human signoff. |
| diagnostic `data/hardval` test | stock `yolo11s-pose` | 0.4058 | 0.1107 | 0.9882 | Prior silver-label stress test only; not a ship gate. |

## Target Table

| Layer | Metric | Target | This Run |
|---|---|---:|---|
| Player/stroke box detection | box mAP@0.5, in-distribution val | 95-98% | 0.7856 clean val |
| Pose keypoints | OKS pose_mAP50 on hard human-verified val | >=0.75 go/no-go | BLOCKED; `hardval_gold` pending human verification |
| Pose keypoints precision | pose_mAP50-95 | Beat stock on gold | BLOCKED; no fine-tune and no signed gold labels |
| Stroke-type classification | accuracy | 85-95% controlled / 70-85% real | Not part of this Tier-1 run |
| End-to-end coaching suggestion | expert agreement | 70-80% | Not measured |

## What Was Done

- Read the runbook and SPEC-3/RESEARCH/REVISED-ARCH context in the requested order.
- Ran `../velo-engine/.venv/bin/python prepare_dataset.py`: confirmed `data/merged` COCO-17 split `1596/200/198`.
- Ran `../velo-engine/.venv/bin/python eval_pose.py --data data/merged/data.yaml`: stock baseline reproduced at `pose_mAP50=0.9591`, `pose_mAP50-95=0.5148`.
- Added `build_hardval_gold.py` and ran it against `data/hardval/images/test`.
- Created `data/hardval_gold/` with 60 high-disagreement frames, draft `yolo11x` labels, numbered overlays, Label Studio config/tasks, `README.md`, `PROVENANCE.md`, `data.yaml`, and `selection_manifest.json`.
- Patched `gatekeeper.py` so provider errors flag frames instead of silently downgrading the whole queue to mock acceptances, and so stale `gate_accepted` files are cleared before reruns.
- Attempted live Gemini triage for `data/pseudo/review`; the batch produced provider errors / hung on retry. No pseudo-label review items were live-accepted, so none were folded into train.
- Checked Modal apps with exported `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`: no running apps/tasks.
- Ran `verify_engine.py` with stock weights; schema-valid v2 telemetry was produced.

## hardval_gold Provenance And Leakage

See `data/hardval_gold/PROVENANCE.md`.

`data/hardval_gold` status is **PENDING_HUMAN_VERIFICATION**. The current labels are
draft labels from `yolo11x-pose.pt`, used only to speed human correction. Do not
evaluate shipping metrics on this directory until a human reviewer completes and
signs the provenance file.

Leakage attestation: selected gold frames come from held-out source clips `869`,
`873`, `876`, and `877`. Existing pseudo-label training hard-source clips are `875`,
`879`, and `880`. No frames from `869`, `873`, `876`, or `877` were copied into
`data/merged/train`.

## Human Review Artifacts

- `data/hardval_gold/overlays/0001_876_0032_coco17_overlay.jpg`
- `data/hardval_gold/overlays/0002_876_0033_coco17_overlay.jpg`
- `data/hardval_gold/overlays/0003_873_0014_coco17_overlay.jpg`
- `data/hardval_gold/overlays/0004_877_0017_coco17_overlay.jpg`
- `data/hardval_gold/overlays/0005_873_0016_coco17_overlay.jpg`
- `data/hardval_gold/overlays/0006_877_0039_coco17_overlay.jpg`

Review task:

```text
data/hardval_gold/label_studio/config.xml
data/hardval_gold/label_studio/tasks.json
```

## Weights And Engine Verification

No fine-tuned `best.pt` was produced. Recommended runtime remains stock:

```bash
export YOLO_WEIGHTS=/Volumes/DevSSD/Projects/2026/VeloApp/lib/velo-engine/yolo11s-pose.pt
```

`verify_engine.py` output with stock weights:

```text
schemaVersion : 2.0 | isMock: False
engine        : yolo11s-pose /Volumes/DevSSD/Projects/2026/VeloApp/lib/velo-training/../velo-engine/yolo11s-pose.pt
video         : 63 frames analyzed, 29.8 fps
subject       : track#1 via most_active; handedness=right(auto); meanKpConf=0.87
strokes       : 4 | dominant: forehand | consistency: 0.36
peak angles   : {'shoulder': 149.5, 'elbow': 179.9, 'wrist': 178.5, 'hip': 180.0, 'knee': 179.9, 'wristIsProxy': 1}
quality       : skippedLowConf=0, occlusionRatio=0.00
SCHEMA-VALID v2 TennisTelemetry produced end-to-end.
```

## Blockers To A Real SHIP Decision

- A human must correct/sign off `data/hardval_gold` before any ship metric is valid.
- No fine-tuned model was trained because the gold gate is not signed off and there were no live-accepted review pseudo-labels to fold into train.
- Mendeley DOI `10.17632/nv3rpsxhhk.1` still needs a reliable file download path or manual download before conversion/merge.
