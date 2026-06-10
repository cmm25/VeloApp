"""
Build the PENDING human-review package for data/hardval_gold.

This intentionally does not create shippable ground truth. It ranks candidate hard
frames by disagreement between stock yolo11s-pose and stronger yolo11x-pose, then
copies the top frames with yolo11x draft labels, numbered COCO-17 overlays, and a
Label Studio import task so a human can verify/correct every keypoint.

Usage:
  python build_hardval_gold.py --candidates data/hardval/images/test --limit 60
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from dataclasses import dataclass
from pathlib import Path

COCO17 = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]

SKELETON = [
    (5, 7), (7, 9), (6, 8), (8, 10), (5, 6),
    (5, 11), (6, 12), (11, 12), (11, 13), (13, 15),
    (12, 14), (14, 16), (0, 1), (0, 2), (1, 3), (2, 4),
]

FLIP_IDX = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]


@dataclass
class Pose:
    box_xywh: list[float]
    box_conf: float
    kxy: list[list[float]]
    kconf: list[float]


@dataclass
class Candidate:
    image: Path
    score: float
    s_pose: Pose | None
    x_pose: Pose | None
    width: int
    height: int


def _best_pose(result) -> Pose | None:
    if result.boxes is None or result.keypoints is None or len(result.boxes) == 0:
        return None
    boxes = result.boxes.xywh.cpu().numpy()
    confs = result.boxes.conf.cpu().numpy()
    kxy = result.keypoints.xy.cpu().numpy()
    if result.keypoints.conf is None:
        kconf = [[1.0] * 17 for _ in range(len(boxes))]
    else:
        kconf = result.keypoints.conf.cpu().numpy()
    best = max(
        range(len(boxes)),
        key=lambda i: float(boxes[i][2] * boxes[i][3]) * float(confs[i]) * float(kconf[i].mean()),
    )
    return Pose(
        box_xywh=[float(v) for v in boxes[best]],
        box_conf=float(confs[best]),
        kxy=[[float(x), float(y)] for x, y in kxy[best]],
        kconf=[float(v) for v in kconf[best]],
    )


def _disagreement(a: Pose | None, b: Pose | None, width: int, height: int) -> float:
    if a is None or b is None:
        return 1e6
    diag = max(1.0, math.hypot(width, height))
    visible = [i for i in range(17) if a.kconf[i] >= 0.2 and b.kconf[i] >= 0.2]
    if not visible:
        return 1e6
    diffs = [
        math.hypot(a.kxy[i][0] - b.kxy[i][0], a.kxy[i][1] - b.kxy[i][1]) / diag
        for i in visible
    ]
    conf_gap = abs(sum(a.kconf) / len(a.kconf) - sum(b.kconf) / len(b.kconf))
    return float(sum(diffs) / len(diffs) + 0.2 * conf_gap)


def _to_yolo_label(pose: Pose, width: int, height: int) -> str:
    cx, cy, bw, bh = pose.box_xywh
    toks = [
        "0",
        f"{cx / width:.6f}",
        f"{cy / height:.6f}",
        f"{bw / width:.6f}",
        f"{bh / height:.6f}",
    ]
    for (x, y), c in zip(pose.kxy, pose.kconf):
        v = 2 if c >= 0.5 else 1
        toks.extend([f"{x / width:.6f}", f"{y / height:.6f}", str(v)])
    return " ".join(toks) + "\n"


def _render_overlay(image_path: Path, draft: Pose | None, stock: Pose | None, out_path: Path) -> None:
    import cv2

    img = cv2.imread(str(image_path))
    if img is None:
        raise RuntimeError(f"failed to read {image_path}")
    canvas = img.copy()

    def draw_pose(pose: Pose | None, color: tuple[int, int, int], label: str, numbered: bool) -> None:
        if pose is None:
            return
        pts: list[tuple[int, int] | None] = []
        for i, ((x, y), conf) in enumerate(zip(pose.kxy, pose.kconf)):
            if conf < 0.2:
                pts.append(None)
                continue
            pt = (int(round(x)), int(round(y)))
            pts.append(pt)
            cv2.circle(canvas, pt, 5 if numbered else 3, color, -1)
            if numbered:
                cv2.putText(
                    canvas, str(i), (pt[0] + 5, pt[1] - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 2, cv2.LINE_AA,
                )
                cv2.putText(
                    canvas, str(i), (pt[0] + 5, pt[1] - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA,
                )
        for a, b in SKELETON:
            if pts[a] is not None and pts[b] is not None:
                cv2.line(canvas, pts[a], pts[b], color, 2, cv2.LINE_AA)
        cx, cy, bw, bh = pose.box_xywh
        x1, y1 = int(cx - bw / 2), int(cy - bh / 2)
        x2, y2 = int(cx + bw / 2), int(cy + bh / 2)
        cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 2)
        cv2.putText(canvas, label, (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

    draw_pose(stock, (0, 0, 255), "stock yolo11s", False)
    draw_pose(draft, (0, 210, 0), "draft yolo11x numbered", True)
    cv2.imwrite(str(out_path), canvas)


def _label_studio_task(image_rel: str, pose: Pose | None, width: int, height: int) -> dict:
    task: dict = {"data": {"image": image_rel}}
    if pose is None:
        return task
    results = []
    cx, cy, bw, bh = pose.box_xywh
    x1 = (cx - bw / 2) / width * 100
    y1 = (cy - bh / 2) / height * 100
    results.append({
        "from_name": "bbox",
        "to_name": "image",
        "type": "rectanglelabels",
        "value": {"x": x1, "y": y1, "width": bw / width * 100, "height": bh / height * 100,
                  "rectanglelabels": ["tennis_player"]},
    })
    for i, ((x, y), conf) in enumerate(zip(pose.kxy, pose.kconf)):
        if conf < 0.2:
            continue
        results.append({
            "from_name": f"kp_{i}",
            "to_name": "image",
            "type": "keypointlabels",
            "value": {"x": x / width * 100, "y": y / height * 100,
                      "keypointlabels": [f"{i}_{COCO17[i]}"]},
        })
    task["predictions"] = [{"model_version": "draft-yolo11x-pose", "score": 0, "result": results}]
    return task


def _label_studio_config() -> str:
    kp_controls = "\n".join(
        f'  <KeyPointLabels name="kp_{i}" toName="image"><Label value="{i}_{name}" background="#0b8f27"/></KeyPointLabels>'
        for i, name in enumerate(COCO17)
    )
    return f"""<View>
  <Image name="image" value="$image"/>
  <RectangleLabels name="bbox" toName="image">
    <Label value="tennis_player" background="#1f77b4"/>
  </RectangleLabels>
{kp_controls}
</View>
"""


def rank_candidates(images: list[Path], stock_weights: str, teacher_weights: str) -> list[Candidate]:
    from ultralytics import YOLO

    stock = YOLO(stock_weights)
    teacher = YOLO(teacher_weights)
    ranked: list[Candidate] = []
    for image in images:
        s_res = stock(str(image), verbose=False)[0]
        x_res = teacher(str(image), verbose=False)[0]
        height, width = x_res.orig_shape
        s_pose = _best_pose(s_res)
        x_pose = _best_pose(x_res)
        ranked.append(Candidate(image, _disagreement(s_pose, x_pose, width, height), s_pose, x_pose, width, height))
    ranked.sort(key=lambda c: c.score, reverse=True)
    return ranked


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default="data/hardval/images/test")
    ap.add_argument("--out", default="data/hardval_gold")
    ap.add_argument("--limit", type=int, default=60)
    ap.add_argument("--stock-weights", default="../velo-engine/yolo11s-pose.pt")
    ap.add_argument("--teacher-weights", default="yolo11x-pose.pt")
    args = ap.parse_args()

    out = Path(args.out)
    img_out = out / "images" / "test"
    lbl_out = out / "labels" / "test"
    overlay_out = out / "overlays"
    task_out = out / "label_studio"
    for d in (img_out, lbl_out, overlay_out, task_out):
        d.mkdir(parents=True, exist_ok=True)

    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    images = sorted(p for p in Path(args.candidates).rglob("*") if p.suffix.lower() in exts)
    ranked = rank_candidates(images, args.stock_weights, args.teacher_weights)
    selected = ranked[: args.limit]

    tasks = []
    manifest = {
        "status": "PENDING_HUMAN_VERIFICATION",
        "source_pool": str(Path(args.candidates).resolve()),
        "selection_rule": f"top {args.limit} by yolo11s-vs-yolo11x keypoint disagreement",
        "stock_weights": args.stock_weights,
        "teacher_weights_for_draft_only": args.teacher_weights,
        "count": len(selected),
        "frames": [],
    }
    for idx, cand in enumerate(selected, 1):
        dst_name = f"{idx:04d}_{cand.image.name}"
        dst_img = img_out / dst_name
        shutil.copy2(cand.image, dst_img)
        if cand.x_pose is not None:
            (lbl_out / f"{Path(dst_name).stem}.txt").write_text(_to_yolo_label(cand.x_pose, cand.width, cand.height))
        _render_overlay(cand.image, cand.x_pose, cand.s_pose, overlay_out / f"{Path(dst_name).stem}_coco17_overlay.jpg")
        rel_image = f"../images/test/{dst_name}"
        tasks.append(_label_studio_task(rel_image, cand.x_pose, cand.width, cand.height))
        manifest["frames"].append({
            "rank": idx,
            "image": dst_name,
            "source_image": str(cand.image),
            "disagreement_score": round(cand.score, 6),
            "draft_label_status": "DRAFT_FROM_YOLO11X_NOT_GROUND_TRUTH",
        })

    (task_out / "tasks.json").write_text(json.dumps(tasks, indent=2))
    (task_out / "config.xml").write_text(_label_studio_config())
    (out / "selection_manifest.json").write_text(json.dumps(manifest, indent=2))
    (out / "data.yaml").write_text(
        f"path: {out.resolve()}\n"
        "train: images/test\n"
        "val: images/test\n"
        "test: images/test\n"
        "names:\n"
        "  0: tennis_player\n"
        "kpt_shape: [17, 3]\n"
        f"flip_idx: {FLIP_IDX}\n"
    )
    print(f"selected {len(selected)} pending frames -> {out}")
    print(f"overlays -> {overlay_out}")
    print(f"Label Studio task -> {task_out / 'tasks.json'}")


if __name__ == "__main__":
    main()
