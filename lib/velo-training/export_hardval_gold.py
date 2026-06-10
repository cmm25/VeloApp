"""
Export human-verified hardval_gold labels from the Label Studio SQLite DB.

Semantics (verified against the DB): each task started from the yolo11x DRAFT
prediction (visible to the human). The human SUBMITTED a completion containing
`origin:manual` keypoint corrections; untouched joints keep the draft position.
So the final label = draft-on-disk, with manual corrections overlaid, and
degenerate draft points (x==y==0) demoted to v=0 (not labeled, ignored by OKS).

Run modes:
  --sample 55,3,29   render merged overlays for these inner_ids -> _merged_overlays/ (no writes to labels)
  --write            overwrite labels/test/*.txt with merged labels + print a per-frame audit
"""
from __future__ import annotations
import argparse, json, os, sqlite3
from pathlib import Path

GOLD = Path(__file__).parent / "data" / "hardval_gold"
DB = Path(os.path.expanduser("~/Library/Application Support/label-studio/label_studio.sqlite3"))
COCO17 = ["nose","left_eye","right_eye","left_ear","right_ear","left_shoulder","right_shoulder",
          "left_elbow","right_elbow","left_wrist","right_wrist","left_hip","right_hip",
          "left_knee","right_knee","left_ankle","right_ankle"]
SKELETON = [(5,7),(7,9),(6,8),(8,10),(5,6),(5,11),(6,12),(11,12),(11,13),(13,15),(12,14),(14,16),(0,1),(0,2),(1,3),(2,4)]


def manifest_order() -> list[str]:
    m = json.loads((GOLD / "selection_manifest.json").read_text())
    return [f["image"] for f in m["frames"]]  # index 0 -> inner_id 1


def load_draft(stem: str) -> tuple[list[float], list[list[float]]]:
    """Return (bbox cx,cy,bw,bh normalized, [[x,y,v],...17] normalized) from disk draft."""
    txt = (GOLD / "labels" / "test" / f"{stem}.txt").read_text().split()
    bbox = [float(t) for t in txt[1:5]]
    kpts = []
    rest = txt[5:]
    for i in range(17):
        x, y, v = float(rest[i*3]), float(rest[i*3+1]), int(float(rest[i*3+2]))
        if x == 0.0 and y == 0.0:   # degenerate model output -> not labeled
            x, y, v = 0.0, 0.0, 0
        kpts.append([x, y, v])
    return bbox, kpts


def manual_corrections(result: list[dict]) -> dict[int, tuple[float, float]]:
    """index -> (x_norm, y_norm) for human-placed keypoints (LS stores percent)."""
    out = {}
    for r in result:
        if r.get("type") == "keypointlabels" and "x" in r.get("value", {}) and r.get("origin") == "manual":
            idx = int(r["value"]["keypointlabels"][0].split("_")[0])
            out[idx] = (r["value"]["x"] / 100.0, r["value"]["y"] / 100.0)
    return out


def merged_label(stem: str, result: list[dict]) -> tuple[list[float], list[list[float]], int]:
    bbox, kpts = load_draft(stem)
    corr = manual_corrections(result)
    for idx, (x, y) in corr.items():
        kpts[idx] = [x, y, 2]
    return bbox, kpts, len(corr)


def to_line(bbox, kpts) -> str:
    toks = ["0"] + [f"{v:.6f}" for v in bbox]
    for x, y, v in kpts:
        toks += [f"{x:.6f}", f"{y:.6f}", str(v)]
    return " ".join(toks) + "\n"


def fetch_completions() -> dict[int, list[dict]]:
    con = sqlite3.connect(str(DB))
    rows = con.execute(
        "SELECT t.inner_id, tc.result FROM task_completion tc "
        "JOIN task t ON t.id=tc.task_id WHERE t.project_id=1 AND tc.was_cancelled=0"
    ).fetchall()
    con.close()
    return {int(inner): json.loads(res) for inner, res in rows}


def render(stem: str, bbox, kpts, out: Path):
    import cv2
    img = cv2.imread(str(GOLD / "images" / "test" / f"{stem}.jpg"))
    h, w = img.shape[:2]
    pts = []
    for i, (x, y, v) in enumerate(kpts):
        if v == 0:
            pts.append(None); continue
        p = (int(x * w), int(y * h)); pts.append(p)
        cv2.circle(img, p, 4, (0, 220, 0), -1)
        cv2.putText(img, str(i), (p[0]+4, p[1]-4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255,255,255), 2)
        cv2.putText(img, str(i), (p[0]+4, p[1]-4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,0,0), 1)
    for a, b in SKELETON:
        if pts[a] and pts[b]:
            cv2.line(img, pts[a], pts[b], (0, 220, 0), 2)
    cx, cy, bw, bh = bbox
    x1, y1 = int((cx-bw/2)*w), int((cy-bh/2)*h)
    x2, y2 = int((cx+bw/2)*w), int((cy+bh/2)*h)
    cv2.rectangle(img, (x1, y1), (x2, y2), (255, 120, 0), 2)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), img)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", default="")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    order = manifest_order()
    comps = fetch_completions()

    if args.sample:
        ids = [int(x) for x in args.sample.split(",")]
        outdir = GOLD / "_merged_overlays"
        for inner in ids:
            stem = Path(order[inner-1]).stem
            bbox, kpts, ncorr = merged_label(stem, comps[inner])
            nlab = sum(1 for _, _, v in kpts if v > 0)
            render(stem, bbox, kpts, outdir / f"merged_{inner:02d}_{stem}.jpg")
            print(f"inner {inner:>2} {stem}: {ncorr} manual corr, {nlab}/17 labeled -> {outdir.name}/merged_{inner:02d}_{stem}.jpg")
        return

    if args.write:
        audit = []
        for inner, stem_img in enumerate(order, 1):
            stem = Path(stem_img).stem
            bbox, kpts, ncorr = merged_label(stem, comps[inner])
            nlab = sum(1 for _, _, v in kpts if v > 0)
            (GOLD / "labels" / "test" / f"{stem}.txt").write_text(to_line(bbox, kpts))
            audit.append((inner, stem, ncorr, nlab))
        avg = sum(a[3] for a in audit) / len(audit)
        print(f"wrote {len(audit)} merged labels; mean labeled kpts/frame = {avg:.1f}")
        for inner, stem, ncorr, nlab in audit:
            print(f"  {inner:>2} {stem}: corr={ncorr} labeled={nlab}/17")


if __name__ == "__main__":
    main()
