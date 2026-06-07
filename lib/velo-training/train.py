"""
Velo Tier-1 pose fine-tune — YOLO11s-pose.

Two ways to run the SAME core trainer:

  Local GPU / Colab / RunPod:
      python train.py --local --data data/merged/data.yaml --epochs 100

  Modal (A10G):
      modal run train.py                      # trains, writes best.pt to a volume
      modal run train.py --epochs 150 --batch 32

Always evaluate the fine-tune against the STOCK baseline before shipping it — a
~4k-image set can underperform COCO-pretrained weights. `--baseline` runs val on
stock yolo11s-pose first so you have an honest before/after mAP. Ship the
fine-tune only if it wins on the held-out split.

The custom kinetic-chain loss (WeightedKeypointLoss, P2) plugs in via
`use_weighted_loss=True` once racket keypoints exist — see velo_loss.py.
"""

import argparse
from pathlib import Path

MODEL = "yolo11s-pose.pt"


def _patch_mps_pose_sigmas(device: str | None):
    if device != "mps":
        return
    import ultralytics.utils.loss as loss

    loss.OKS_SIGMA = loss.OKS_SIGMA.astype("float32")


def train_core(
    data_yaml: str,
    epochs: int = 100,
    imgsz: int = 640,
    batch: int = 16,
    project: str = "runs",
    name: str = "velo-pose",
    device: str | None = None,
    use_weighted_loss: bool = False,
    run_baseline: bool = False,
):
    """Backbone-agnostic trainer body — runs anywhere ultralytics + torch are installed."""
    from ultralytics import YOLO

    _patch_mps_pose_sigmas(device)

    if run_baseline:
        print("── baseline: stock yolo11s-pose on this val split ──")
        base = YOLO(MODEL)
        base_metrics = base.val(data=data_yaml, imgsz=imgsz, device=device)
        print(f"baseline pose mAP50-95: {base_metrics.pose.map:.4f}")

    model = YOLO(MODEL)

    if use_weighted_loss:
        # P2: bias the gradient toward the dominant kinetic chain (wrist/hip/racket).
        from velo_loss import patch_weighted_keypoint_loss
        patch_weighted_keypoint_loss(model)
        print("WeightedKeypointLoss patched in (kinetic-chain weighting active).")

    results = model.train(
        data=data_yaml,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=device,
        project=project,
        name=name,
        patience=20,
        plots=True,
    )
    print(f"\nDone. Best weights: {results.save_dir}/weights/best.pt")
    print("Drop that path into velo-engine's YOLO_WEIGHTS to serve it.")
    return results


def _modal_data_yaml(dataset_dir: str = "/vol/merged") -> str:
    """Use the Modal volume path instead of the local absolute path in data.yaml."""
    src = Path(dataset_dir) / "data.yaml"
    dst = Path(dataset_dir) / "data_modal.yaml"
    text = src.read_text()
    lines = [
        f"path: {dataset_dir}" if line.startswith("path: ") else line
        for line in text.splitlines()
    ]
    dst.write_text("\n".join(lines) + "\n")
    return str(dst)


def train_two_stage(
    data_yaml: str,
    imgsz: int = 640,
    batch: int = 16,
    project: str = "runs",
    device: str | None = None,
    run_baseline: bool = False,
    use_weighted_loss: bool = False,
    name: str = "velo-pose",
):
    """SPEC-3 two-stage freeze -> unfreeze recipe."""
    from ultralytics import YOLO

    _patch_mps_pose_sigmas(device)

    if run_baseline:
        print("── baseline: stock yolo11s-pose on this val split ──")
        base = YOLO(MODEL)
        base_metrics = base.val(data=data_yaml, imgsz=imgsz, device=device)
        print(f"baseline pose mAP50-95: {base_metrics.pose.map:.4f}")

    stage1 = YOLO(MODEL)

    if use_weighted_loss:
        # velo19: bias gradient toward the dominant chain + racket butt/tip (idx 17/18).
        from velo_loss import patch_weighted_keypoint_loss
        patch_weighted_keypoint_loss(stage1)
        print("WeightedKeypointLoss patched (velo19 kinetic-chain + racket).")
    r1 = stage1.train(
        data=data_yaml,
        epochs=30,
        imgsz=imgsz,
        batch=batch,
        device=device,
        project=project,
        name=f"{name}-s1",
        freeze=10,
        optimizer="AdamW",
        lr0=0.001,
        mosaic=0.5,
        close_mosaic=5,
        patience=15,
        plots=True,
    )

    stage1_best = Path(r1.save_dir) / "weights" / "best.pt"
    stage2 = YOLO(str(stage1_best))
    r2 = stage2.train(
        data=data_yaml,
        epochs=70,
        imgsz=imgsz,
        batch=batch,
        device=device,
        project=project,
        name=name,
        freeze=0,
        optimizer="AdamW",
        lr0=0.0001,
        lrf=0.01,
        cos_lr=True,
        mosaic=0.5,
        patience=20,
        plots=True,
    )
    print(f"\nDone. Final best weights: {r2.save_dir}/weights/best.pt")
    return r2


# ── Modal entrypoint ──────────────────────────────────────────────────────────
try:
    import modal

    app = modal.App("velo-pose-train")
    image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("libgl1", "libglib2.0-0", "ffmpeg")
        # numpy<2 is REQUIRED: ultralytics 8.3.40 calls np.trapz, removed in numpy 2.0.
        .pip_install("numpy==1.26.4", "ultralytics==8.3.40", "roboflow")
        # velo_loss is a sibling local module imported inside train_*(); modal 1.4 needs
        # it added explicitly or the remote container raises ModuleNotFoundError.
        .add_local_python_source("velo_loss")
    )
    # Persisted dataset + output weights across runs.
    volume = modal.Volume.from_name("velo-pose-data", create_if_missing=True)

    @app.function(
        image=image,
        gpu="A10G",
        volumes={"/vol": volume},
        timeout=60 * 60 * 6,  # 6h headroom so a 2-stage 100-epoch run can't be killed mid-train
        # Add `secrets=[modal.Secret.from_name("roboflow")]` to prep data in-cloud.
    )
    def train_modal(epochs: int = 100, batch: int = 16, baseline: bool = False,
                    dataset: str = "velo19", weighted: bool = True, name: str = "velo19"):
        # Expects the dataset synced to the volume at /vol/<dataset>.
        # (Upload locally: `modal volume put velo-pose-data data/velo19 /velo19`.)
        data_yaml = _modal_data_yaml(f"/vol/{dataset}")
        if epochs == 100:
            train_two_stage(data_yaml=data_yaml, batch=batch, project="/vol/runs",
                            run_baseline=baseline, use_weighted_loss=weighted, name=name)
        else:
            train_core(
                data_yaml=data_yaml,
                epochs=epochs,
                batch=batch,
                project="/vol/runs",
                name=name,
                run_baseline=baseline,
                use_weighted_loss=weighted,
            )
        volume.commit()

    @app.local_entrypoint()
    def main(epochs: int = 100, batch: int = 16, baseline: bool = False,
             dataset: str = "velo19", weighted: bool = True, name: str = "velo19"):
        train_modal.remote(epochs=epochs, batch=batch, baseline=baseline,
                           dataset=dataset, weighted=weighted, name=name)

except ImportError:
    pass  # modal not installed — local CLI below still works


# ── Local CLI ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true", help="run locally (not via modal)")
    ap.add_argument("--data", default="data/merged/data.yaml")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default=None, help="Ultralytics device, e.g. mps, cuda:0, cpu")
    ap.add_argument("--two-stage", action="store_true", help="run SPEC-3 freeze -> unfreeze recipe")
    ap.add_argument("--baseline", action="store_true", help="val stock weights first")
    ap.add_argument("--weighted-loss", action="store_true", help="P2 kinetic-chain loss")
    args = ap.parse_args()

    if args.local:
        if args.two_stage:
            train_two_stage(
                data_yaml=args.data,
                batch=args.batch,
                imgsz=args.imgsz,
                device=args.device,
                run_baseline=args.baseline,
            )
        else:
            train_core(
                data_yaml=args.data,
                epochs=args.epochs,
                batch=args.batch,
                imgsz=args.imgsz,
                device=args.device,
                run_baseline=args.baseline,
                use_weighted_loss=args.weighted_loss,
            )
    else:
        print("Run with --local, or use `modal run train.py` for the Modal path.")
