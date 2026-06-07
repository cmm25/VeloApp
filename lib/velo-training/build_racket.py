"""
Build a RACKET-ONLY [5,3] pose dataset (option 1: the separate racket head).

Class = racket; bbox = racket bbox; keypoints = RacketVision's 5 (top,bottom,handle,
left,right). NO body keypoints — so this model is trained/served independently of the
COCO-17 body model and body pose CANNOT collapse (the Phase-2 failure mode). The engine
fuses this model's racket_tip(=top, idx0) / racket_butt(=bottom, idx1) into velo19 telemetry
downstream, leaving stock coco17 body untouched.

Fast build: no teacher inference — just frame extraction + JSON parse. Trains at higher
imgsz (rackets are small in broadcast frames). Output: data/racket/{images,labels}/{train,val,test}.
Usage: .venv/bin/python build_racket.py [--max-frames N]
"""
import argparse
import glob
import json
from collections import defaultdict
from pathlib import Path

import cv2

ROOT = Path(__file__).parent
RV = ROOT / "data" / "racketvision" / "tennis"
OUT = ROOT / "data" / "racket"
# RacketVision keypoint order: [top, bottom, handle, left, right]
# horizontal flip swaps left<->right only (top/bottom/handle map to themselves).
FLIP5 = [0, 1, 2, 4, 3]


def find_racket_jsons():
    out = defaultdict(dict)
    for p in glob.glob(str(RV / "all" / "*" / "racket" / "*" / "*.json")):
        parts = Path(p).parts
        out[(parts[-4], parts[-2])][int(Path(p).stem)] = p
    return out


def resolve_video(match: str, clip: str):
    for pat in (f"{match}_{clip}", f"{match}*{clip}", clip):
        hits = [h for h in glob.glob(str(RV / "videos" / f"*{pat}*"))
                if h.lower().endswith((".mp4", ".mov", ".avi", ".mkv"))]
        if hits:
            return hits[0]
    return None


def split_for(match: str) -> str:
    h = int("".join(c for c in match if c.isdigit()) or "0") % 10
    return "train" if h < 8 else ("val" if h == 8 else "test")


def label_lines(rackets, W, H):
    lines = []
    for r in rackets:
        kps = r.get("keypoints") or []
        if len(kps) != 5:
            continue
        x, y, w, h = r["bbox_xywh"]  # top-left xywh (pixels)
        if w <= 1 or h <= 1:
            continue
        parts = [0, (x + w / 2) / W, (y + h / 2) / H, w / W, h / H]
        for kx, ky, kv in kps:
            v = 2 if kv > 0 else 0
            parts += [kx / W if v else 0.0, ky / H if v else 0.0, v]
        lines.append(" ".join(f"{p:.6f}" if isinstance(p, float) else str(p) for p in parts))
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-frames", type=int, default=999999)
    args = ap.parse_args()
    for sp in ("train", "val", "test"):
        (OUT / "images" / sp).mkdir(parents=True, exist_ok=True)
        (OUT / "labels" / sp).mkdir(parents=True, exist_ok=True)

    clips = find_racket_jsons()
    print(f"racket clips: {len(clips)} | frames: {sum(len(v) for v in clips.values())}")
    kept = defaultdict(int); skipped = defaultdict(int); n = 0
    for (match, clip), frames in sorted(clips.items()):
        if n >= args.max_frames:
            break
        video = resolve_video(match, clip)
        if not video:
            skipped["no_video"] += len(frames); continue
        cap = cv2.VideoCapture(video)
        W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        if not W or not H:
            cap.release(); skipped["bad_video"] += len(frames); continue
        sp = split_for(match)
        for fnum, jp in sorted(frames.items()):
            if n >= args.max_frames:
                break
            cap.set(cv2.CAP_PROP_POS_FRAMES, fnum)
            ok, frame = cap.read()
            if not ok:
                skipped["bad_frame"] += 1; continue
            try:
                rackets = json.loads(Path(jp).read_text())
            except Exception:
                skipped["bad_json"] += 1; continue
            lines = label_lines(rackets, W, H)
            if not lines:
                skipped["no_racket"] += 1; continue
            stem = f"{match}_{clip}_{fnum:04d}"
            cv2.imwrite(str(OUT / "images" / sp / f"{stem}.jpg"), frame)
            (OUT / "labels" / sp / f"{stem}.txt").write_text("\n".join(lines) + "\n")
            kept[sp] += 1; n += 1
        cap.release()

    yaml = (f"# racket-only [5,3]: top,bottom,handle,left,right. Built by build_racket.py\n"
            f"path: {OUT}\ntrain: images/train\nval: images/val\ntest: images/test\n"
            f"nc: 1\nnames:\n  0: racket\nkpt_shape: [5, 3]\nflip_idx: {FLIP5}\n")
    (OUT / "data.yaml").write_text(yaml)
    print(f"kept: {dict(kept)} | skipped: {dict(skipped)}")
    for sp in ("train", "val", "test"):
        print(f"  {sp}: {len(list((OUT/'images'/sp).glob('*.jpg')))} imgs")


if __name__ == "__main__":
    main()
