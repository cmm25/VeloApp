"""
P0 smoke test for the velo-engine YOLO pose pipeline.

Covers both verification-plan items:
  1. Hits POST /analyze for one or more clips, prints a comparison table.
  2. Validates each response against the TennisTelemetry pydantic schema
     (the exact contract the agent runner + Gemini layer expect).
  3. --overlay renders keypoints onto frames so you can eyeball whether the
     model hallucinates joints on occluded body parts.

Usage
-----
  # engine must be running:  VISION_ENGINE=yolo uvicorn src.main:app --port 8000

  python test_engine.py                              # default GVHMR clip
  python test_engine.py URL_OR_PATH [URL2 ...]       # your own clips
  python test_engine.py --sample-rate 5
  python test_engine.py --engine-url http://localhost:8000
  python test_engine.py --overlay path/or/url.mp4    # save annotated frames (uses ultralytics directly)

Only direct-download URLs work for the /analyze path (the engine fetches them).
Local paths work with --overlay. The one URL verified live (May 2026):
  GVHMR tennis.mp4 — side-on broadcast singles, ~2.1MB.
"""

import argparse
import sys

import httpx

DEFAULT_CLIPS = [
    # name, url — verified live. Add your own (Pinata/IPFS gateway URLs, etc.).
    ("gvhmr-singles", "https://raw.githubusercontent.com/zju3dv/GVHMR/main/docs/example_video/tennis.mp4"),
]


def _validate_schema(payload: dict) -> str:
    """Return '' if payload conforms to TennisTelemetry, else the error string."""
    try:
        from src.models import TennisTelemetry
    except Exception as e:
        return f"(schema import failed: {e})"
    try:
        TennisTelemetry(**payload)
        return ""
    except Exception as e:
        return str(e).splitlines()[0]


def run_table(clips: list[tuple[str, str]], engine_url: str, sample_rate: int):
    rows = []
    for name, url in clips:
        print(f"→ analyzing {name} … ", end="", flush=True)
        try:
            r = httpx.post(
                f"{engine_url}/analyze",
                json={"video_url": url, "sample_rate": sample_rate},
                timeout=300.0,
            )
        except Exception as e:
            print(f"REQUEST FAILED: {e}")
            rows.append((name, "—", "—", "—", "—", f"request error: {e}"))
            continue

        if r.status_code != 200:
            print(f"HTTP {r.status_code}")
            rows.append((name, "—", "—", "—", "—", f"HTTP {r.status_code}: {r.text[:80]}"))
            continue

        d = r.json()
        schema_err = _validate_schema(d)
        aggregate = d.get("aggregate", {})
        video = d.get("video", {})
        peak = aggregate.get("peakAngles", {})
        rows.append((
            name,
            str(video.get("framesAnalyzed", "?")),
            aggregate.get("dominantStroke", "?"),
            f"{aggregate.get('consistencyScore', 0):.2f}",
            f"sh{peak.get('shoulder', 0):.0f}/el{peak.get('elbow', 0):.0f}/wr{peak.get('wrist', 0):.0f}",
            "SCHEMA FAIL: " + schema_err if schema_err else ("mock!" if d.get("is_mock") else "ok"),
        ))
        print("done")

    # print table
    hdr = ("clip", "frames", "stroke", "consistency", "peak sh/el/wr", "status")
    widths = [max(len(str(x)) for x in col) for col in zip(hdr, *rows)] if rows else [len(h) for h in hdr]
    line = "  ".join(h.ljust(w) for h, w in zip(hdr, widths))
    print("\n" + line)
    print("-" * len(line))
    for row in rows:
        print("  ".join(str(c).ljust(w) for c, w in zip(row, widths)))

    fails = [r for r in rows if "FAIL" in r[5] or "error" in r[5] or r[5].startswith("HTTP")]
    print(f"\n{len(rows) - len(fails)}/{len(rows)} clips passed.")
    return 1 if fails else 0


def run_overlay(source: str, sample_rate: int, conf: float = 0.35):
    """Render selected-subject overlays to ./overlays/ using YOLO tracking."""
    import os
    from collections import defaultdict
    import cv2
    import numpy as np
    from ultralytics import YOLO

    path = source
    if source.startswith(("http://", "https://")):
        import tempfile
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        print(f"downloading {source} …")
        with httpx.stream("GET", source, follow_redirects=True, timeout=120) as resp:
            resp.raise_for_status()
            for chunk in resp.iter_bytes(65536):
                tmp.write(chunk)
        path = tmp.name

    os.makedirs("overlays", exist_ok=True)
    model = YOLO(os.getenv("YOLO_WEIGHTS", "yolo11s-pose.pt"))
    cap = cv2.VideoCapture(path)
    frames = []
    tracks = defaultdict(list)
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_rate != 0:
            frame_idx += 1
            continue
        res = model.track(frame, persist=True, conf=conf, verbose=False)[0]
        if res.boxes is not None and res.boxes.id is not None and res.keypoints is not None:
            ids = res.boxes.id.cpu().numpy().astype(int)
            boxes = res.boxes.xyxy.cpu().numpy()
            kpts = res.keypoints.xy.cpu().numpy()
            frames.append((frame_idx, frame.copy(), ids, boxes, kpts))
            for det_i, tid in enumerate(ids):
                tracks[int(tid)].append(kpts[det_i])
        frame_idx += 1
    cap.release()

    def motion(seq):
        return sum(float(np.mean(np.linalg.norm(seq[i] - seq[i - 1], axis=1))) for i in range(1, len(seq)))

    selected = max(tracks, key=lambda tid: (motion(tracks[tid]), len(tracks[tid])))
    saved = 0
    for frame_idx, frame, ids, boxes, kpts in frames:
        if saved >= 6:
            break
        if selected not in ids:
            continue
        for det_i, tid in enumerate(ids):
            color = (0, 220, 0) if int(tid) == selected else (0, 0, 220)
            x1, y1, x2, y2 = boxes[det_i].astype(int)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)
            cv2.putText(frame, f"track {int(tid)} {'SELECTED student' if int(tid) == selected else 'rejected'}",
                        (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            for x, y in kpts[det_i].astype(int):
                cv2.circle(frame, (x, y), 3, color, -1)
        out = f"overlays/selected_student_{saved:02d}_frame_{frame_idx}.jpg"
        cv2.imwrite(out, frame)
        print(out)
        saved += 1
    print(f"selected track_id={selected}; saved {saved} overlay frames.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="*", help="video URLs or local paths")
    ap.add_argument("--engine-url", default="http://localhost:8000")
    ap.add_argument("--sample-rate", type=int, default=5)
    ap.add_argument("--overlay", metavar="SRC", help="render keypoint overlays for one clip")
    args = ap.parse_args()

    if args.overlay:
        run_overlay(args.overlay, args.sample_rate)
        return

    clips = [(c.split("/")[-1][:20], c) for c in args.clips] if args.clips else DEFAULT_CLIPS
    sys.exit(run_table(clips, args.engine_url, args.sample_rate))


if __name__ == "__main__":
    main()
