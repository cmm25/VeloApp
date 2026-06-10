"""
Experiment runner for the Velo pose finetune iteration loop (Modal A10G).

Why this exists: a naive finetune on the mostly-easy tennis set CATASTROPHICALLY forgot
hard-case poses (hardval_gold pose_mAP50 0.762 -> 0.149). The fix, per the vetting+methods
research, is (1) COCO-person keypoint REPLAY mixed into training as anti-forgetting, and
(2) selecting best.pt on a DIVERSE val (tennis + COCO), not the easy tennis val that picks
the over-specialized checkpoint.

Each experiment:
  - model configurable (yolo11s-pose.pt default; yolo26s-pose.pt / yolo11m-pose.pt as arms)
  - train = [/vol/merged tennis train] + [/vol/coco_replay COCO-person subset]
  - val   = [/vol/merged tennis val] + [/vol/coco_replay COCO val subset]   <- diverse selection
  - hardval_gold stays UNTOUCHED as the final gate (eval locally with eval_pose.py)

COCO-pose is cached once to the volume at /vol/coco_replay (idempotent).

Run:
  modal run exp_train.py --model yolo11s-pose.pt --replay 3000 --name s_replay3k
  modal run exp_train.py --model yolo26s-pose.pt --replay 3000 --name 26s_replay3k
Then pull weights + eval:
  modal volume get velo-pose-data /runs/<name>/weights/best.pt weights/<name>.pt
  python eval_pose.py --data data/hardval_gold/data.yaml --finetuned weights/<name>.pt --split test
"""
from __future__ import annotations

FLIP_IDX = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]

try:
    import modal

    app = modal.App("velo-pose-exp")
    image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("libgl1", "libglib2.0-0", "ffmpeg")
        # numpy<2 required: ultralytics 8.3.40 calls np.trapz (removed in numpy 2.0).
        .pip_install("numpy==1.26.4", "ultralytics==8.3.40")
    )
    volume = modal.Volume.from_name("velo-pose-data", create_if_missing=True)

    def _do_prep(n_train: int = 3000, n_val: int = 400):
        """Download COCO-pose once, cache a class-0 (person) subset to /vol/coco_replay. Idempotent.
        Runs INSIDE a Modal container (where /vol is mounted)."""
        import shutil, random
        from pathlib import Path

        out = Path("/vol/coco_replay")
        done = out / ".done"
        if done.exists():
            print(f"coco_replay already cached at {out}")
            return
        from ultralytics.data.utils import check_det_dataset

        info = check_det_dataset("coco-pose.yaml", autodownload=True)  # downloads to /root/datasets
        base = Path(info["path"])  # .../datasets/coco-pose
        random.seed(0)

        def take(split_img_dir: Path, split_lbl_dir: Path, n: int, dst_img: Path, dst_lbl: Path):
            dst_img.mkdir(parents=True, exist_ok=True)
            dst_lbl.mkdir(parents=True, exist_ok=True)
            # only images that actually carry a person-keypoint label (non-empty txt)
            labels = [p for p in split_lbl_dir.glob("*.txt") if p.stat().st_size > 0]
            random.shuffle(labels)
            kept = 0
            for lbl in labels:
                if kept >= n:
                    break
                img = split_img_dir / (lbl.stem + ".jpg")
                if not img.exists():
                    continue
                shutil.copy2(img, dst_img / img.name)
                shutil.copy2(lbl, dst_lbl / lbl.name)
                kept += 1
            print(f"  {dst_img} <- {kept} images")
            return kept

        take(base / "images/train2017", base / "labels/train2017", n_train, out / "images", out / "labels")
        take(base / "images/val2017", base / "labels/val2017", n_val, out / "val/images", out / "val/labels")
        done.write_text("ok")
        volume.commit()
        print("coco_replay cached.")

    @app.function(image=image, gpu="A10G", volumes={"/vol": volume}, timeout=60 * 60 * 6)
    def prep_coco_replay(n_train: int = 3000, n_val: int = 400):
        _do_prep(n_train, n_val)

    def _write_yaml(use_replay: bool) -> str:
        import os
        from pathlib import Path
        train = ["/vol/merged/images/train"]
        val = ["/vol/merged/images/val"]
        if use_replay:
            train.append("/vol/coco_replay/images")
            val.append("/vol/coco_replay/val/images")
        # Hard pseudo-labeled frames (STEP 3) — train-only, included whenever present on the volume.
        if os.path.isdir("/vol/hard_pseudo/images"):
            train.append("/vol/hard_pseudo/images")
            print("including /vol/hard_pseudo/images in train")
        y = Path("/vol/exp_data.yaml")
        y.write_text(
            "path: /\n"
            f"train: {train}\n"
            f"val: {val}\n"
            "names:\n  0: person\n"
            "kpt_shape: [17, 3]\n"
            f"flip_idx: {FLIP_IDX}\n"
        )
        return str(y)

    def _two_stage(model: str, data_yaml: str, e1: int, e2: int, batch: int, name: str, pose_gain: float):
        from ultralytics import YOLO
        import shutil
        from pathlib import Path
        s1 = YOLO(model)
        r1 = s1.train(
            data=data_yaml, epochs=e1, imgsz=640, batch=batch, project="/vol/runs",
            name=f"{name}-s1", exist_ok=True, freeze=10, optimizer="AdamW", lr0=0.001, mosaic=0.5,
            close_mosaic=5, patience=15, pose=pose_gain, plots=False,
        )
        s2 = YOLO(str(Path(r1.save_dir) / "weights" / "best.pt"))
        r2 = s2.train(
            data=data_yaml, epochs=e2, imgsz=640, batch=batch, project="/vol/runs",
            name=name, exist_ok=True, freeze=0, optimizer="AdamW", lr0=0.0001, lrf=0.01, cos_lr=True,
            mosaic=0.5, patience=20, pose=pose_gain, plots=False,
        )
        # Copy final weights to a DETERMINISTIC, collision-free location + DONE marker for polling.
        best_dir = Path("/vol/best")
        best_dir.mkdir(parents=True, exist_ok=True)
        final = best_dir / f"{name}.pt"
        shutil.copy2(Path(r2.save_dir) / "weights" / "best.pt", final)
        (best_dir / f"{name}.DONE").write_text(str(r2.save_dir))
        print(f"Done. final weights -> {final}")

    @app.function(image=image, gpu="A10G", volumes={"/vol": volume}, timeout=60 * 60 * 6)
    def train_exp(model: str, replay: int, e1: int, e2: int, batch: int, name: str, pose_gain: float):
        use_replay = replay > 0
        if use_replay:
            _do_prep(n_train=replay, n_val=400)  # runs in-container, fills /vol/coco_replay
        data_yaml = _write_yaml(use_replay)
        print(f"=== EXP {name}: model={model} replay={replay} e1={e1} e2={e2} batch={batch} pose={pose_gain} ===")
        print(f"data.yaml:\n{open(data_yaml).read()}")
        # honest in-cloud baseline on the diverse val for reference
        from ultralytics import YOLO
        base = YOLO(model)
        bm = base.val(data=data_yaml, imgsz=640)
        print(f"baseline (diverse val) pose mAP50-95: {bm.pose.map:.4f}")
        _two_stage(model, data_yaml, e1, e2, batch, name, pose_gain)
        volume.commit()

    @app.local_entrypoint()
    def main(model: str = "yolo11s-pose.pt", replay: int = 3000, e1: int = 20, e2: int = 40,
             batch: int = 16, name: str = "exp", pose_gain: float = 12.0):
        train_exp.remote(model=model, replay=replay, e1=e1, e2=e2, batch=batch, name=name, pose_gain=pose_gain)

except ImportError:
    pass
