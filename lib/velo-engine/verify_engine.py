"""
End-to-end Tier-1 smoke: download a clean tennis clip, run the restored YOLO11s-pose
engine, and confirm it emits a schema-valid v2 TennisTelemetry. Proves the engine
(post stash-restore) works before the training handoff. CPU-only.

  cd lib/velo-engine && .venv/bin/python verify_engine.py
"""
import json
import sys
import tempfile
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from src.yolo_analyze import analyze_video_file
from src.models import SubjectRequest, KeyframeFormat, TennisTelemetry

URL = "https://raw.githubusercontent.com/zju3dv/GVHMR/main/docs/example_video/tennis.mp4"


def fetch(url: str) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
    for verify in (True, False):
        try:
            r = requests.get(url, timeout=180, verify=verify)
            r.raise_for_status()
            Path(tmp).write_bytes(r.content)
            print(f"downloaded {len(r.content)} bytes -> {tmp}")
            return tmp
        except Exception as e:
            last = e
    raise SystemExit(f"download failed: {last}")


def main():
    path = fetch(URL)
    tel = analyze_video_file(
        path, URL, sample_rate=5, max_duration_s=20.0, video_cid=None,
        subject=SubjectRequest(), emit_keyframes=True, keyframe_format=KeyframeFormat.base64,
        emit_raw_keypoints=False,
    )
    # round-trip the camelCase wire JSON back through the schema → proves it's valid
    wire = tel.model_dump(by_alias=True, mode="json")
    TennisTelemetry.model_validate(wire)  # raises if the wire JSON is not schema-valid

    s = tel.subject
    print("\n──────────── TIER-1 TELEMETRY ────────────")
    print("schemaVersion :", wire["schemaVersion"], "| isMock:", wire["isMock"])
    print("engine        :", wire["engine"]["backbone"], wire["engine"].get("weights"))
    print("video         :", f'{wire["video"]["framesAnalyzed"]} frames analyzed, {wire["video"]["fps"]:.1f} fps')
    print("subject       :", f'track#{s.track_id} via {s.selection_strategy}; handedness={s.handedness}({s.handedness_source}); meanKpConf={s.mean_keypoint_confidence:.2f}')
    print("strokes       :", len(tel.strokes), "| dominant:", wire["aggregate"]["dominantStroke"],
          "| consistency:", round(wire["aggregate"]["consistencyScore"], 2))
    print("peak angles   :", {k: round(v, 1) for k, v in wire["aggregate"]["peakAngles"].items() if isinstance(v, (int, float))})
    kf = tel.strokes[0].keyframes if tel.strokes else []
    print("keyframe[0]   :", "base64 len=" + str(len(kf[0].image_base64)) if kf and kf[0].image_base64 else "none")
    print("quality       :", f'skippedLowConf={wire["quality"]["framesSkippedLowConf"]}, occlusionRatio={wire["quality"]["occlusionRatio"]:.2f}')
    print("\n✅ SCHEMA-VALID v2 TennisTelemetry produced end-to-end.")
    Path("/tmp/velo_engine_telemetry.json").write_text(json.dumps({k: v for k, v in wire.items() if k != "strokes"}, indent=2))


if __name__ == "__main__":
    main()
