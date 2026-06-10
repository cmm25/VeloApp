"""
Stage-2 keypoint pseudo-labeling — the CORRECT core of the auto-annotation loop.

Why this exists: GroundingDINO / SAM produce BOUNDING BOXES / MASKS, never keypoints
(verified: X-Pose paper — "Grounding-DINO fails to localize fine-grained keypoints"),
and MLLMs score ~50% on spatial-pose tasks, so they cannot emit coordinates either.
The only sound way to bootstrap COCO-17 keypoint labels from unlabelled tennis frames
is to run a TOP-DOWN POSE MODEL over them and gate by confidence:

    frames ──▶ top-down pose model (YOLO11-pose here; ViTPose-H / RTMPose give
               higher-quality labels — see CODEX-SPEC-3) ──▶ per-instance 17 kpts
            ──▶ confidence gate:  mean kpt-conf ≥ --conf  → AUTO-ACCEPT (write label)
                                  else                    → REVIEW queue (human / MLLM triage)

An MLLM (Gemini 2.5 Flash-Lite, Set-of-Mark prompt) may later TRIAGE the review queue —
flagging anatomically implausible skeletons — but it never produces coordinates.
Output is YOLO-pose format (class 0 = tennis_player), ready to merge via prepare_dataset.

  python pseudo_label.py --images path/to/frames --out data/pseudo --conf 0.6
  python pseudo_label.py --video clip.mp4 --fps 5 --out data/pseudo
"""

import argparse
import json
from pathlib import Path

KP_CONF_MIN = 0.5          # per-keypoint floor (matches velo-engine KP_CONF_MIN)
REQUIRED = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]  # shoulders/elbows/wrists/hips/knees (kinetic chain)


def frames_from_video(video: str, out_dir: Path, fps_sample: int) -> Path:
    import cv2
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(video)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(src_fps / fps_sample))
    i = n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i % step == 0:
            cv2.imwrite(str(out_dir / f"frame_{n:05d}.jpg"), frame)
            n += 1
        i += 1
    cap.release()
    print(f"extracted {n} frames @ ~{fps_sample}fps -> {out_dir}")
    return out_dir


def pseudo_label(images_dir: Path, out: Path, weights: str, conf: float) -> dict:
    from ultralytics import YOLO

    model = YOLO(weights)
    img_out, lbl_out, review = out / "images", out / "labels", out / "review"
    for d in (img_out, lbl_out, review):
        d.mkdir(parents=True, exist_ok=True)

    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    imgs = sorted(p for p in images_dir.rglob("*") if p.suffix.lower() in exts)
    stats = {"total": len(imgs), "auto": 0, "review": 0, "no_person": 0}

    for p in imgs:
        r = model(str(p), verbose=False)[0]
        if r.keypoints is None or r.boxes is None or len(r.boxes) == 0:
            stats["no_person"] += 1
            continue
        H, W = r.orig_shape
        boxes = r.boxes.xywh.cpu().numpy()
        kxy = r.keypoints.xy.cpu().numpy()
        kconf = (r.keypoints.conf.cpu().numpy() if r.keypoints.conf is not None
                 else __import__("numpy").ones((len(boxes), 17)))
        # pick the most prominent person: box area * mean keypoint confidence
        best = max(range(len(boxes)), key=lambda i: boxes[i][2] * boxes[i][3] * (kconf[i].mean()))
        bx, kp, kc = boxes[best], kxy[best], kconf[best]
        mean_conf = float(kc.mean())
        chain_ok = all(kc[j] >= KP_CONF_MIN for j in REQUIRED)

        cx, cy, w, h = bx[0] / W, bx[1] / H, bx[2] / W, bx[3] / H
        toks = ["0", f"{cx:.6f}", f"{cy:.6f}", f"{w:.6f}", f"{h:.6f}"]
        for j in range(17):
            v = 2 if kc[j] >= KP_CONF_MIN else 1
            toks += [f"{kp[j][0] / W:.6f}", f"{kp[j][1] / H:.6f}", str(v)]

        if mean_conf >= conf and chain_ok:
            (lbl_out / f"{p.stem}.txt").write_text(" ".join(toks) + "\n")
            (img_out / p.name).write_bytes(p.read_bytes())
            stats["auto"] += 1
        else:
            # save the frame for human/MLLM review (its low-conf guess goes alongside)
            (review / p.name).write_bytes(p.read_bytes())
            (review / f"{p.stem}.guess.txt").write_text(" ".join(toks) + "\n")
            stats["review"] += 1

    (out / "manifest.json").write_text(json.dumps(stats, indent=2))
    print("\n──────────── PSEUDO-LABEL REPORT ────────────")
    for k, v in stats.items():
        print(f"  {k:10s} {v}")
    acc = stats["auto"] / max(1, stats["total"])
    print(f"  auto-accept rate: {acc:.1%}  (review queue -> human/MLLM triage; SPEC-3 §gatekeeper)")
    print("  Next: fold out/images + out/labels into data/merged train, then re-eval.")
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", help="dir of frames to pseudo-label")
    ap.add_argument("--video", help="video to sample frames from first")
    ap.add_argument("--fps", type=int, default=5, help="frames/sec to sample from --video")
    ap.add_argument("--out", default="data/pseudo")
    ap.add_argument("--weights", default="yolo11s-pose.pt",
                    help="top-down pose model; SPEC-3 recommends a stronger labeler (ViTPose-H/RTMPose)")
    ap.add_argument("--conf", type=float, default=0.6, help="mean-keypoint-conf auto-accept threshold")
    args = ap.parse_args()

    out = Path(args.out)
    if args.video:
        images_dir = frames_from_video(args.video, out / "frames", args.fps)
    elif args.images:
        images_dir = Path(args.images)
    else:
        raise SystemExit("provide --images DIR or --video FILE")
    pseudo_label(images_dir, out, args.weights, args.conf)


if __name__ == "__main__":
    main()
