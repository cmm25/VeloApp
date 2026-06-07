"""
Build the velo19 [19,3] pose dataset = COCO-17 body + racket_butt(17) + racket_tip(18).

RacketVision has racket-5 keypoints (top,bottom,handle,left,right) but NO body pose, so:
  1. extract racket-labeled frames from tennis/videos,
  2. pseudo-label body COCO-17 with a strong teacher (yolo11x-pose),
  3. assign the racket to the nearest player, map top->tip(18), bottom->butt(17),
  4. write a 19-kpt YOLO-pose label.
Anti-collapse: also PAD the existing tennis-17 `data/merged` to 19 kpts (racket=0,0,0
= unlabeled, ignored by OKS) and mix it in, so body keypoints stay supervised/diverse
and don't collapse the way the body-only finetune did (0.762->0.149).

Output: data/velo19/{images,labels}/{train,val,test} + data/velo19/data.yaml.
Split by MATCH id (leakage-safe). Usage: .venv/bin/python build_velo19.py [--max-frames N]
"""
import argparse
import glob
import json
import os
import shutil
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).parent
RV = ROOT / "data" / "racketvision" / "tennis"
MERGED = ROOT / "data" / "merged"
OUT = ROOT / "data" / "velo19"
TEACHER = os.getenv("YOLO_TEACHER", str(ROOT / "yolo11x-pose.pt"))
KP_CONF = 0.5
BODY_MIN_CONF = 0.4  # mean body kpt conf to accept a pseudo-labeled player
COCO17_FLIP = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]
FLIP19 = COCO17_FLIP + [17, 18]  # racket tip/butt unaffected by horizontal flip


def find_racket_jsons():
    """{(match, clip): {frame_int: json_path}}"""
    out = defaultdict(dict)
    for p in glob.glob(str(RV / "all" / "*" / "racket" / "*" / "*.json")):
        parts = Path(p).parts
        match = parts[-4]            # e.g. match114
        clip = parts[-2]             # e.g. 000
        frame = int(Path(p).stem)    # e.g. 0009 -> 9
        out[(match, clip)][frame] = p
    return out


def resolve_video(match: str, clip: str):
    """Find the source video for a (match, clip). Naming discovered at runtime."""
    for pat in (f"{match}_{clip}", f"{match}/{clip}", f"{match}*{clip}", f"{clip}"):
        hits = glob.glob(str(RV / "videos" / f"*{pat}*"))
        hits = [h for h in hits if h.lower().endswith((".mp4", ".mov", ".avi", ".mkv"))]
        if hits:
            return hits[0]
    return None


def load_teacher():
    from ultralytics import YOLO
    return YOLO(TEACHER)


def pseudo_label_persons(model, frame):
    """Return [(box_cxcywh, kpts(17,2), conf(17))] for detected persons."""
    r = model.predict(frame, verbose=False, device="cpu", conf=0.25)[0]
    if r.keypoints is None or r.boxes is None or len(r.boxes) == 0:
        return []
    boxes = r.boxes.xywh.cpu().numpy()
    xy = r.keypoints.xy.cpu().numpy()
    cf = r.keypoints.conf
    cf = cf.cpu().numpy() if cf is not None else np.ones((len(boxes), 17))
    return [(boxes[i], xy[i], cf[i]) for i in range(len(boxes))]


def assign_player(persons, racket):
    """Assign the racket to the player whose bbox it sits at/inside.

    Broadcast frames have 2 players; "nearest center" mis-assigns a racket to the
    wrong (closer-centered) player or to a player far from the racket's true owner.
    Instead: use the racket-keypoint centroid (pixels) and the point→box distance
    (0 if inside the player box); pick the nearest player and REJECT if the racket is
    farther than ~0.6× that player's box height — i.e. the racket isn't plausibly held
    by any detected player (distant owner / occlusion / frame mismatch)."""
    kps = [(kp[0], kp[1]) for kp in racket["keypoints"] if kp[2] > 0]
    if not kps:
        rx, ry, rw, rh = racket["bbox_xywh"]
        kps = [(rx + rw / 2.0, ry + rh / 2.0)]
    rc = np.mean(np.array(kps, dtype=float), axis=0)
    best, bd, bh = None, 1e18, 1.0
    for idx, (box, xy, cf) in enumerate(persons):
        cx, cy, w, h = [float(v) for v in box]
        dx = max(cx - w / 2 - rc[0], 0.0, rc[0] - (cx + w / 2))
        dy = max(cy - h / 2 - rc[1], 0.0, rc[1] - (cy + h / 2))
        d = (dx * dx + dy * dy) ** 0.5
        if d < bd:
            bd, best, bh = d, idx, h
    if best is None or bd > 0.6 * bh:
        return None  # racket not plausibly held by any detected player → reject frame
    return best


def label_line_19(box_cxcywh, body_xy, body_cf, racket_kpts, W, H):
    """YOLO pose line: cls cx cy w h then 19*(x y v), normalized."""
    cx, cy, w, h = box_cxcywh
    parts = [0, cx / W, cy / H, w / W, h / H]
    for j in range(17):
        v = 2 if body_cf[j] >= KP_CONF else 0
        x, y = (body_xy[j] if v else (0.0, 0.0))
        parts += [x / W if v else 0.0, y / H if v else 0.0, v]
    # racket: kp[0]=top->tip(idx18 emitted last), kp[1]=bottom->butt(idx17 emitted first)
    butt = racket_kpts[1]   # bottom
    tip = racket_kpts[0]    # top
    for kp in (butt, tip):
        x, y, vis = kp
        v = 2 if vis > 0 else 0
        parts += [x / W if v else 0.0, y / H if v else 0.0, v]
    return " ".join(f"{p:.6f}" if isinstance(p, float) else str(p) for p in parts)


def split_for(match: str) -> str:
    """Deterministic leakage-safe split by match-id hash: ~80/10/10."""
    h = int("".join(c for c in match if c.isdigit()) or "0") % 10
    return "train" if h < 8 else ("val" if h == 8 else "test")


def pad_merged_to_19():
    """Pad existing tennis-17 merged labels to 19 kpts (racket=0 0 0) → body anti-collapse."""
    n = 0
    for split in ("train", "val", "test"):
        img_dir = MERGED / "images" / split
        lbl_dir = MERGED / "labels" / split
        if not img_dir.exists():
            continue
        for img in list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png")):
            lbl = lbl_dir / (img.stem + ".txt")
            if not lbl.exists():
                continue
            out_lines = []
            for line in lbl.read_text().strip().splitlines():
                t = line.split()
                # expect cls + 4 bbox + 17*3 = 56 tokens; pad to + 2*3
                if len(t) >= 56:
                    out_lines.append(" ".join(t[:56] + ["0", "0", "0", "0", "0", "0"]))
            if not out_lines:
                continue
            dst = "train" if split == "train" else split
            shutil.copy(img, OUT / "images" / dst / f"m_{img.name}")
            (OUT / "labels" / dst / f"m_{img.stem}.txt").write_text("\n".join(out_lines) + "\n")
            n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-frames", type=int, default=4000, help="cap RacketVision frames (CPU pseudo-label budget)")
    args = ap.parse_args()

    for split in ("train", "val", "test"):
        (OUT / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUT / "labels" / split).mkdir(parents=True, exist_ok=True)

    clips = find_racket_jsons()
    print(f"racket-labeled clips: {len(clips)} | total labeled frames: {sum(len(v) for v in clips.values())}")
    model = load_teacher()

    kept = defaultdict(int)
    skipped = defaultdict(int)
    processed = 0
    for (match, clip), frames in sorted(clips.items()):
        if processed >= args.max_frames:
            break
        video = resolve_video(match, clip)
        if not video:
            skipped["no_video"] += len(frames)
            continue
        cap = cv2.VideoCapture(video)
        W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        if W == 0 or H == 0:
            cap.release(); skipped["bad_video"] += len(frames); continue
        sp = split_for(match)
        for fnum, jpath in sorted(frames.items()):
            if processed >= args.max_frames:
                break
            cap.set(cv2.CAP_PROP_POS_FRAMES, fnum)
            ok, frame = cap.read()
            if not ok:
                skipped["bad_frame"] += 1; continue
            try:
                rackets = json.loads(Path(jpath).read_text())
            except Exception:
                skipped["bad_json"] += 1; continue
            if not rackets:
                skipped["empty"] += 1; continue
            racket = rackets[0]
            persons = pseudo_label_persons(model, frame)
            processed += 1
            if not persons:
                skipped["no_person"] += 1; continue
            pi = assign_player(persons, racket)
            if pi is None:
                skipped["racket_far"] += 1; continue
            box, body_xy, body_cf = persons[pi]
            if float(np.mean(body_cf)) < BODY_MIN_CONF:
                skipped["low_body_conf"] += 1; continue
            line = label_line_19(box, body_xy, body_cf, racket["keypoints"], W, H)
            stem = f"{match}_{clip}_{fnum:04d}"
            cv2.imwrite(str(OUT / "images" / sp / f"{stem}.jpg"), frame)
            (OUT / "labels" / sp / f"{stem}.txt").write_text(line + "\n")
            kept[sp] += 1
        cap.release()
        if processed and processed % 200 == 0:
            print(f"  …processed {processed} frames, kept {sum(kept.values())}")

    n_pad = pad_merged_to_19()
    print(f"RacketVision kept: {dict(kept)} | skipped: {dict(skipped)} | padded merged(17→19): {n_pad}")

    yaml = f"""# velo19 = COCO-17 + racket_butt(17) + racket_tip(18). Built by build_velo19.py
path: {OUT}
train: images/train
val: images/val
test: images/test
nc: 1
names:
  0: tennis_player
kpt_shape: [19, 3]
flip_idx: {FLIP19}
"""
    (OUT / "data.yaml").write_text(yaml)
    for sp in ("train", "val", "test"):
        c = len(list((OUT / "images" / sp).glob("*.jpg")))
        print(f"  {sp}: {c} images")
    print(f"data.yaml → {OUT/'data.yaml'}")


if __name__ == "__main__":
    main()
