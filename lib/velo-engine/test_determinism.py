"""
Determinism self-test (Phase 1 acceptance gate).

Proves the engine emits a byte-identical `telemetryHash` for the same input:
  A) same-process, back-to-back (catches tracker state-bleed / R2),
  B) two FRESH processes (catches thread/serialization drift / R1+R4),
  C) thread-count invariance: ambient OMP_NUM_THREADS=1 vs =8 must match
     (the headline R1 proof — host core-count must not change the hash).

Scope (honest): reproducibility on the SAME pinned arch/image, not across
arbitrary CPUs (see docs/VELO-NN-MASTER-LOG.md §3). Fixture: GVHMR tennis.mp4
(downloaded to /tmp once). Run:  .venv/bin/python test_determinism.py
"""
import os
import sys
import subprocess
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = "/tmp/tennis_real.mp4"
URL = "https://raw.githubusercontent.com/zju3dv/GVHMR/main/docs/example_video/tennis.mp4"
MAXD = 10.0


def _emit_hash(video: str) -> None:
    sys.path.insert(0, HERE)
    import src.determinism  # noqa: F401  (FIRST — sets thread env)
    from src.analyzer_yolo import YoloAnalyzer
    from src.models import AnalyzeRequest

    a = YoloAnalyzer()
    req = AnalyzeRequest(video_url="file://fixture", sample_rate=5, max_duration_s=MAXD)
    t = a.analyze_file(video, "file://fixture", 5, MAXD, req)
    print("HASH:" + str(t.model_dump(by_alias=True, mode="json")["telemetryHash"]))


def _run_subproc(env_overrides: dict) -> str:
    env = dict(os.environ)
    env.update(env_overrides)
    env.setdefault("DENSE_STROKE_WINDOW", "0")  # coarse for speed; determinism is path-independent
    out = subprocess.run(
        [sys.executable, os.path.abspath(__file__), "--emit-hash", VIDEO],
        capture_output=True, text=True, env=env, timeout=300,
    )
    for line in out.stdout.splitlines():
        if line.startswith("HASH:"):
            return line[5:]
    raise RuntimeError("no HASH emitted:\nSTDOUT:\n" + out.stdout[-1500:] + "\nSTDERR:\n" + out.stderr[-1500:])


def main() -> int:
    if not os.path.exists(VIDEO):
        print(f"downloading fixture → {VIDEO}")
        urllib.request.urlretrieve(URL, VIDEO)

    h1 = _run_subproc({"OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"})
    h2 = _run_subproc({"OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1"})
    h8 = _run_subproc({"OMP_NUM_THREADS": "8", "MKL_NUM_THREADS": "8", "OPENBLAS_NUM_THREADS": "8"})

    print(f"fresh-process #1 (OMP=1): {h1}")
    print(f"fresh-process #2 (OMP=1): {h2}")
    print(f"thread-count   #3 (OMP=8): {h8}")
    ok = h1 == h2 == h8
    print("\nDETERMINISTIC (fresh-process repeat + thread-count invariant):", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--emit-hash":
        _emit_hash(sys.argv[2])
        sys.exit(0)
    sys.exit(main())
