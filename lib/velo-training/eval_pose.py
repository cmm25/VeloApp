"""
Honest baseline-vs-fine-tune evaluation for the Velo Tier-1 pose model.

Reports OKS-based pose mAP (the metric that actually matters for joint-angle quality)
and box mAP, on a held-out split. The COCO-pretrained stock model is the baseline the
fine-tune MUST beat on the SAME held-out split to earn its place in the engine — a
small (~2k-image) set can underperform COCO-pretrained weights, so this gate is the
difference between shipping a real improvement and shipping a regression.

Metric notes (from Ultralytics source):
- pose.map / pose.map50  = OKS-based mAP@[.5:.95] / @.5  (keypoint localization)
- box.map  / box.map50   = IoU-based detection mAP        (player box)
- Valid OKS sigmas only apply for kpt_shape=[17,*]; this dataset is COCO-17 by design.

Usage:
  python eval_pose.py --data data/merged/data.yaml                      # stock baseline only
  python eval_pose.py --data data/merged/data.yaml \
      --finetuned runs/velo-pose/weights/best.pt                        # baseline vs fine-tune + verdict
  python eval_pose.py --data data/merged/data.yaml --split test
"""

import argparse
import json
from pathlib import Path

# Stock COCO-pretrained weights live in the engine (pre-baked). Fall back to the
# Ultralytics auto-download name if not present.
_ENGINE_WEIGHTS = Path(__file__).resolve().parents[1] / "velo-engine" / "yolo11s-pose.pt"
DEFAULT_BASELINE = str(_ENGINE_WEIGHTS) if _ENGINE_WEIGHTS.exists() else "yolo11s-pose.pt"


def evaluate(weights: str, data: str, split: str, imgsz: int) -> dict:
    from ultralytics import YOLO

    model = YOLO(weights)
    r = model.val(data=data, split=split, imgsz=imgsz, verbose=False, plots=False)
    return {
        "weights": weights,
        "split": split,
        "pose_map50_95": round(float(r.pose.map), 4),
        "pose_map50": round(float(r.pose.map50), 4),
        "pose_map75": round(float(r.pose.map75), 4),
        "box_map50_95": round(float(r.box.map), 4),
        "box_map50": round(float(r.box.map50), 4),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/merged/data.yaml")
    ap.add_argument("--baseline", default=DEFAULT_BASELINE, help="stock/COCO weights")
    ap.add_argument("--finetuned", default=None, help="fine-tuned best.pt to compare")
    ap.add_argument("--split", default="val", choices=["val", "test"])
    ap.add_argument("--imgsz", type=int, default=640)
    args = ap.parse_args()

    rows = [("baseline", evaluate(args.baseline, args.data, args.split, args.imgsz))]
    if args.finetuned:
        rows.append(("finetuned", evaluate(args.finetuned, args.data, args.split, args.imgsz)))

    print("\n──────────── POSE EVAL (split=%s) ────────────" % args.split)
    hdr = f"{'model':10s} {'pose_mAP50':>11s} {'pose_mAP50-95':>14s} {'box_mAP50':>10s}"
    print(hdr)
    for name, m in rows:
        print(f"{name:10s} {m['pose_map50']:>11.4f} {m['pose_map50_95']:>14.4f} {m['box_map50']:>10.4f}")

    if args.finetuned:
        base, fine = rows[0][1], rows[1][1]
        d50 = fine["pose_map50"] - base["pose_map50"]
        d5095 = fine["pose_map50_95"] - base["pose_map50_95"]
        print(f"\nΔ pose_mAP50 = {d50:+.4f}   Δ pose_mAP50-95 = {d5095:+.4f}")
        ship = d50 > 0 and d5095 > 0
        print("VERDICT:", "✅ SHIP the fine-tune (beats stock on held-out)"
              if ship else "❌ DO NOT SHIP — fine-tune does not beat stock; keep COCO weights / get more data")
        print(f"Go/no-go gate (CODEX-SPEC-3): pose_mAP50 ≥ 0.75 → got {fine['pose_map50']:.4f}")

    Path("eval_results.json").write_text(json.dumps([r[1] for r in rows], indent=2))
    print("\nSaved -> eval_results.json")


if __name__ == "__main__":
    main()
