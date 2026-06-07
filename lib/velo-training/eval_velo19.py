"""
Evaluate a velo19 [19,3] pose model on two axes (the scheduled-agent stop criterion):

  1. RACKET-LEARNING  — pose mAP on the velo19 TEST split (held-out broadcast frames
     with racket butt/tip labels). Higher = the model learned the joint body+racket task.
  2. BODY-NON-COLLAPSE — pose mAP on a 19-padded hardval_gold (body-17 labeled, racket
     unlabeled→OKS-ignored). Detects the catastrophic-forgetting collapse (→~0.1) that
     killed the body-only finetune. NOTE: kpt_shape=[19,*] uses UNIFORM OKS sigmas, so
     this is NOT directly comparable to the 17-kpt COCO-sigma 0.466 baseline — it is a
     RELATIVE/collapse signal, read alongside the velo19-test number.

Usage:
  python eval_velo19.py --weights runs/velo19/weights/best.pt
Emits JSON to stdout (the agent parses it).
"""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
HV = ROOT / "data" / "hardval_gold"
HV19 = ROOT / "data" / "hardval_gold19"
VELO19 = ROOT / "data" / "velo19" / "data.yaml"
FLIP19 = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 17, 18]
COLLAPSE_FLOOR = 0.30  # velo19-uniform-sigma body mAP below this ⇒ likely body collapse


def build_hardval19() -> Path:
    """Pad hardval_gold (17-kpt) → 19-kpt (racket cols = 0 0 0) so a 19-kpt model can be val'd."""
    (HV19 / "images" / "test").mkdir(parents=True, exist_ok=True)
    (HV19 / "labels" / "test").mkdir(parents=True, exist_ok=True)
    for img in (HV / "images" / "test").glob("*"):
        if img.suffix.lower() in (".jpg", ".png", ".jpeg"):
            shutil.copy(img, HV19 / "images" / "test" / img.name)
    for lbl in (HV / "labels" / "test").glob("*.txt"):
        out = []
        for line in lbl.read_text().strip().splitlines():
            t = line.split()
            if len(t) >= 56:
                out.append(" ".join(t[:56] + ["0", "0", "0", "0", "0", "0"]))
        if out:
            (HV19 / "labels" / "test" / lbl.name).write_text("\n".join(out) + "\n")
    (HV19 / "data.yaml").write_text(
        f"path: {HV19}\ntrain: images/test\nval: images/test\ntest: images/test\n"
        f"nc: 1\nnames:\n  0: tennis_player\nkpt_shape: [19, 3]\nflip_idx: {FLIP19}\n"
    )
    return HV19 / "data.yaml"


def _val(weights: str, data_yaml: str, split: str) -> dict:
    from ultralytics import YOLO
    r = YOLO(weights).val(data=data_yaml, split=split, imgsz=640, verbose=False, plots=False)
    return {"pose_map50_95": round(float(r.pose.map), 4), "pose_map50": round(float(r.pose.map50), 4),
            "box_map50": round(float(r.box.map50), 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    args = ap.parse_args()

    hv19 = build_hardval19()
    racket = _val(args.weights, str(VELO19), "test")
    body = _val(args.weights, str(hv19), "test")
    collapsed = body["pose_map50_95"] < COLLAPSE_FLOOR
    verdict = {
        "weights": args.weights,
        "velo19_test": racket,           # racket-learning (body+racket, uniform sigma)
        "hardval_body": body,            # body-non-collapse signal
        "body_collapsed": collapsed,
        "ship_candidate": (not collapsed) and racket["pose_map50_95"] > 0.30,
    }
    print(json.dumps(verdict, indent=2))


if __name__ == "__main__":
    main()
