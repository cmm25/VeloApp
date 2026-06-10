"""
Velo dataset prep — download Roboflow tennis-pose data, convert to COCO-17, build a
leakage-safe YOLO-pose dataset (data/merged) with a correct data.yaml.

GROUND TRUTH (measured directly, 2026-06-01 — supersedes earlier notes)
-----------------------------------------------------------------------
1. The gdv `coco` export is DEAD server-side (downloads a 257-byte NoSuchKey XML →
   BadZipFile). The SDK cannot regenerate it. **The `yolov8` export WORKS**, so we
   pull yolov8 (it already carries kpt_shape + per-instance keypoints).
2. Every tennis-pose Roboflow set (gdv / degree / tennis-0ytvl) uses the SAME
   18-keypoint skeleton = **COCO-17 + a `neck` point at index 17**. Indices 0–16 are
   exactly canonical COCO-17. Drop index 17 → an exact COCO-17 model that is DROP-IN
   for velo-engine (`yolo_analyze.py` assumes COCO-17). Keeping 18 kpts would force
   Ultralytics onto a uniform 1/N OKS sigma → metrics non-comparable to COCO. So we
   drop the neck.
3. The exports ship `flip_idx` as the identity `[0..17]`, which is WRONG — horizontal
   flip would NOT swap left/right joints and would corrupt labels. We write the
   correct COCO L/R `flip_idx`.
4. These sets heavily OVERLAP (all derive from the same ~2k base, then Roboflow-
   augmented). Naive merge + random split leaks augmented copies of one base image
   across train/val → fake-high val mAP. So the default build uses ONE source's
   OFFICIAL Roboflow split (Roboflow separates base images across splits). Extra
   sources are opt-in (--merge-extra) and are appended to TRAIN ONLY; val/test always
   come from the primary source.

Usage
-----
  python prepare_dataset.py --inspect-only     # download primary (yolov8) + report skeleton verdict
  python prepare_dataset.py                     # build data/merged (COCO-17) from the primary source
  python prepare_dataset.py --merge-extra       # also append extra sources into TRAIN only (more data)

Key auto-read from repo-root .env (ROBOTFLOW_PRIVATE_API_KEY). Use Python 3.11.
The Mendeley CC BY 4.0 seed set (DOI 10.17632/nv3rpsxhhk.1, 2k imgs, same COCO-18)
is a cleaner citable supplement — see README / CODEX-SPEC-3 for how to fold it in.
"""

import argparse
import json
import os
import shutil
from pathlib import Path

# ── COCO-17 (what velo-engine/yolo_analyze.py assumes). Index 17 in the source data
#    is 'neck' and is dropped. ───────────────────────────────────────────────────
COCO17 = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]
# Correct horizontal-flip pairing for COCO-17 (eyes/ears/shoulders/elbows/wrists/
# hips/knees/ankles swap; nose is on the central axis).
COCO_FLIP_IDX = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]

# Verified-working yolov8 sources (Roboflow). The primary's official split is used for
# val/test; extras (opt-in) are appended to train only.
PRIMARY = {"name": "tennis-action", "workspace": "tennis-0ytvl",
           "project": "tennis-action", "version": 3}
EXTRAS = [
    {"name": "degree-detection", "workspace": "degree",
     "project": "tennis-pose-detection", "version": 2},          # ~10.4k imgs
    {"name": "degree-erpft", "workspace": "degree",
     "project": "tennis-pose-estimation-erpft", "version": 1},   # ~4.8k imgs
    {"name": "gdv-primary", "workspace": "gdv",
     "project": "tennis-pose-estimation-erpft-hkvax-inuk5", "version": 4},  # ~2k imgs
]

ROOT = Path(__file__).parent
RAW = ROOT / "data" / "raw"
MERGED = ROOT / "data" / "merged"
KEY_VARS = ["ROBOTFLOW_PRIVATE_API_KEY", "ROBOFLOW_PRIVATE_API_KEY", "ROBOFLOW_API_KEY"]


def _load_dotenv():
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        env = parent / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            break


def _api_key() -> str:
    _load_dotenv()
    for var in KEY_VARS:
        if os.environ.get(var):
            return os.environ[var]
    raise SystemExit(f"No Roboflow key in {KEY_VARS} (.env, Private API Key).")


def _yolo_dir_ok(d: Path) -> bool:
    """A yolov8 download is real only if it has a data.yaml + a labels dir with files."""
    return d.exists() and (d / "data.yaml").exists() and any(d.glob("*/labels/*.txt"))


def download(ds: dict) -> Path:
    """Download a Roboflow project in yolov8 format (idempotent)."""
    from roboflow import Roboflow

    dest = RAW / f"{ds['name']}__v{ds['version']}__yolov8"
    if _yolo_dir_ok(dest):
        print(f"[skip] {ds['name']} already at {dest}")
        return dest
    if dest.exists():
        shutil.rmtree(dest)  # wipe a failed/partial download
    print(f"[get ] {ds['name']}: {ds['workspace']}/{ds['project']} v{ds['version']} (yolov8)")
    rf = Roboflow(api_key=_api_key())
    rf.workspace(ds["workspace"]).project(ds["project"]).version(ds["version"]).download(
        "yolov8", location=str(dest)
    )
    if not _yolo_dir_ok(dest):
        raise SystemExit(f"Download for {ds['name']} did not yield a valid yolov8 dir.")
    return dest


# ── label conversion: 18-kpt (COCO-17 + neck) → COCO-17, single class ─────────────
def _convert_label_line(line: str) -> str | None:
    """class cx cy w h (px py v)*K  →  '0 cx cy w h (px py v)*17'. Returns None to skip."""
    t = line.split()
    if len(t) < 5:
        return None
    n_kpt = (len(t) - 5) // 3
    if (len(t) - 5) % 3 != 0 or n_kpt not in (17, 18):
        return None  # unexpected schema → skip (don't fabricate)
    bbox = t[1:5]
    kpts = t[5:5 + 17 * 3]  # keep the first 17 keypoints; drop neck (idx 17) if present
    return " ".join(["0", *bbox, *kpts])


def _convert_split(src: Path, dst_img: Path, dst_lbl: Path, prefix: str) -> int:
    """Copy images + convert labels from one yolov8 split. Returns #pairs written."""
    src_img, src_lbl = src / "images", src / "labels"
    if not src_img.exists() or not src_lbl.exists():
        return 0
    dst_img.mkdir(parents=True, exist_ok=True)
    dst_lbl.mkdir(parents=True, exist_ok=True)
    n = 0
    for lbl in sorted(src_lbl.glob("*.txt")):
        img = next((p for p in src_img.glob(lbl.stem + ".*")), None)
        if img is None:
            continue
        out_lines = [c for c in (_convert_label_line(l) for l in lbl.read_text().splitlines()) if c]
        if not out_lines:
            continue  # no valid person/keypoints → drop (anti-hallucination)
        stem = f"{prefix}__{lbl.stem}"  # namespace to avoid cross-source filename collisions
        (dst_lbl / f"{stem}.txt").write_text("\n".join(out_lines) + "\n")
        shutil.copy2(img, dst_img / f"{stem}{img.suffix}")
        n += 1
    return n


def build(merge_extra: bool) -> None:
    if MERGED.exists():
        shutil.rmtree(MERGED)
    counts = {}
    # primary → train/val/test (Roboflow's leakage-safe official split)
    p = download(PRIMARY)
    split_map = {"train": "train", "valid": "val", "test": "test"}
    for src_name, dst_name in split_map.items():
        counts[f"primary/{dst_name}"] = _convert_split(
            p / src_name, MERGED / "images" / dst_name, MERGED / "labels" / dst_name,
            prefix=PRIMARY["name"],
        )
    # extras → TRAIN ONLY (never val/test — avoids cross-source base-image leakage)
    if merge_extra:
        for ds in EXTRAS:
            try:
                d = download(ds)
            except SystemExit as e:
                print(f"[warn] extra {ds['name']} skipped: {e}")
                continue
            added = 0
            for src_name in ("train", "valid", "test"):
                added += _convert_split(
                    d / src_name, MERGED / "images" / "train", MERGED / "labels" / "train",
                    prefix=ds["name"],
                )
            counts[f"extra/{ds['name']}->train"] = added

    yaml_text = (
        f"# Velo tennis pose — COCO-17 (neck dropped). Built by prepare_dataset.py\n"
        f"path: {MERGED.resolve()}\n"
        f"train: images/train\n"
        f"val: images/val\n"
        f"test: images/test\n"
        f"nc: 1\n"
        f"names:\n  0: tennis_player\n"
        f"kpt_shape: [17, 3]\n"
        f"flip_idx: {COCO_FLIP_IDX}\n"
    )
    (MERGED / "data.yaml").write_text(yaml_text)

    print("\n════════════ BUILD REPORT ════════════")
    for k, v in counts.items():
        print(f"  {k:32s} {v}")
    print(f"  data.yaml -> {MERGED / 'data.yaml'}")
    print("  kpt_shape=[17,3]  flip_idx=COCO L/R  nc=1(tennis_player)")
    print("══════════════════════════════════════")
    print("Next: python eval_pose.py --data data/merged/data.yaml   # honest baseline")
    print("Then: python train.py --local --data data/merged/data.yaml --epochs 100 --baseline")


def inspect_only() -> None:
    """Download the primary yolov8 set and report the COCO-17 compatibility verdict."""
    import yaml as _yaml

    d = download(PRIMARY)
    cfg = _yaml.safe_load((d / "data.yaml").read_text())
    n_kpt = (cfg.get("kpt_shape") or [None])[0]
    sample = next(d.glob("*/labels/*.txt"), None)
    toks = len(sample.read_text().splitlines()[0].split()) if sample else 0
    print("\n════════════ SKELETON REPORT ════════════")
    print(f"  source     : {PRIMARY['workspace']}/{PRIMARY['project']} v{PRIMARY['version']} (yolov8)")
    print(f"  kpt_shape  : {cfg.get('kpt_shape')}  (label tokens/inst = {toks})")
    print(f"  flip_idx   : {cfg.get('flip_idx')}  <- identity in source = WRONG, we rewrite to COCO")
    if n_kpt == 18:
        print("  VERDICT    : PATH A ✅ — 18 kpts = COCO-17 + neck. Drop idx 17 → exact COCO-17, drop-in for engine.")
    elif n_kpt == 17:
        print("  VERDICT    : PATH A ✅ — already COCO-17.")
    else:
        print(f"  VERDICT    : PATH B ⚠ — custom {n_kpt}-kpt skeleton; do not blind-finetune (see CODEX-SPEC-3).")
    print("══════════════════════════════════════")
    print("Run without --inspect-only to build data/merged.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect-only", action="store_true", help="download primary + print skeleton verdict")
    ap.add_argument("--merge-extra", action="store_true", help="append extra sources into TRAIN only (more data)")
    args = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    if args.inspect_only:
        inspect_only()
    else:
        build(merge_extra=args.merge_extra)


if __name__ == "__main__":
    main()
