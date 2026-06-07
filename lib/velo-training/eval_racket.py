"""Eval a racket-only [5,3] model on the racket test split. Racket OKS mAP + detection.
No body gate (body is a separate, untouched coco17 model). Emits JSON for the monitor."""
import argparse
import json

ap = argparse.ArgumentParser()
ap.add_argument("--weights", required=True)
ap.add_argument("--imgsz", type=int, default=960)
a = ap.parse_args()

from ultralytics import YOLO

r = YOLO(a.weights).val(data="data/racket/data.yaml", split="test", imgsz=a.imgsz, verbose=False, plots=False)
m = {
    "racket_map5095": round(float(r.pose.map), 4),
    "racket_map50": round(float(r.pose.map50), 4),
    "box_map50": round(float(r.box.map50), 4),
}
# detector can't localize the racket at all ⇒ full-frame approach failed (rackets too small)
m["too_small_fail"] = m["box_map50"] < 0.10
m["ship_candidate"] = (not m["too_small_fail"]) and m["racket_map5095"] > 0.30
print(json.dumps(m, indent=2))
