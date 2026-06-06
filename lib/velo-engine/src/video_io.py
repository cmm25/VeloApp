"""Shared video I/O — backbone-neutral so neither pose engine is forced to import the other."""

import hashlib
import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import httpx

log = logging.getLogger("video_io")
MAX_DOWNLOAD_BYTES = int(os.getenv("MAX_VIDEO_BYTES", str(200 * 1024 * 1024)))
ALLOWED_CONTENT_TYPES = ("video/", "application/octet-stream", "binary/octet-stream")

# Pass-0 normalization target. Phones record VFR / nominal-fps clips on which
# OpenCV frame-seek is unreliable and `frame_index/fps` timestamps are WRONG.
# Transcoding to constant-frame-rate fixes both AND yields a hashable, byte-stable
# input — the on-chain determinism anchor. Disable via NORMALIZE_CFR=0.
NORMALIZE_CFR = os.getenv("NORMALIZE_CFR", "1").lower() not in ("0", "false", "no")
CFR_MAX_FPS = int(os.getenv("CFR_MAX_FPS", "60"))


async def download_video(url: str, max_duration_s: float = 45.0) -> str:
    """Download video to a temp file. Returns the temp file path."""
    suffix = Path(url.split("?")[0]).suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        tmp_path = f.name

    # Own our temp file's cleanup on EVERY failure path (bad content-type, oversize,
    # undecodable codec, cancellation) — main.py's finally only sees the path once it
    # is RETURNED, so a raise here would otherwise orphan the temp file.
    try:
        log.info(f"Downloading video: {url}")
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            async with client.stream("GET", url) as r:
                r.raise_for_status()
                content_type = r.headers.get("content-type", "").split(";")[0].strip().lower()
                if content_type and not any(content_type.startswith(prefix) for prefix in ALLOWED_CONTENT_TYPES):
                    raise ValueError(f"Unsupported video content-type: {content_type}")
                content_length = r.headers.get("content-length")
                if content_length and int(content_length) > MAX_DOWNLOAD_BYTES:
                    raise ValueError(f"Video exceeds max download size ({MAX_DOWNLOAD_BYTES} bytes)")
                downloaded = 0
                with open(tmp_path, "wb") as f:
                    async for chunk in r.aiter_bytes(chunk_size=65536):
                        downloaded += len(chunk)
                        if downloaded > MAX_DOWNLOAD_BYTES:
                            raise ValueError(f"Video exceeds max download size ({MAX_DOWNLOAD_BYTES} bytes)")
                        f.write(chunk)

        cap = None
        try:
            import cv2
            cap = cv2.VideoCapture(tmp_path)
            if not cap.isOpened():
                raise ValueError("Downloaded file is not a readable video/codec")
            frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
            if frames <= 0 or fps <= 0:
                raise ValueError("Downloaded video has invalid frame count or fps")
        finally:
            if cap is not None:
                cap.release()
    except BaseException:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise

    log.info(f"Downloaded to {tmp_path} ({os.path.getsize(tmp_path) / 1024:.1f} KB)")
    return tmp_path


def frame_stream_sha256(path: str) -> Optional[str]:
    """
    SHA-256 of the DECODED raw frame stream (the exact yuv420p pixels OpenCV/YOLO see),
    not the codec-dependent .mp4 bytes. This is the honest determinism anchor: it proves
    the decode is reproducible independently of model nondeterminism. Computed only on the
    canonical/on-chain path (it re-decodes the whole clip). Returns None if ffmpeg absent.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    cmd = [ffmpeg, "-nostdin", "-i", path, "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"]
    try:
        h = hashlib.sha256()
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        for chunk in iter(lambda: proc.stdout.read(1 << 20), b""):
            h.update(chunk)
        proc.stdout.close()
        if proc.wait(timeout=180) != 0:
            return None
        return h.hexdigest()
    except Exception as e:
        log.warning(f"frame_stream_sha256 failed: {e}")
        return None


def _probe_fps(ffprobe: str, path: str) -> tuple[Optional[float], Optional[bool]]:
    """Return (fps, is_vfr) via ffprobe; (None, None) on failure. VFR ⇔ avg_frame_rate ≠ r_frame_rate."""
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=avg_frame_rate,r_frame_rate", "-of", "json", path],
            capture_output=True, text=True, timeout=30,
        )
        st = json.loads(out.stdout)["streams"][0]

        def _ratio(s: str) -> Optional[float]:
            try:
                n, d = s.split("/")
                d = float(d)
                return float(n) / d if d else None
            except Exception:
                return None

        avg = _ratio(st.get("avg_frame_rate", "0/0"))
        r = _ratio(st.get("r_frame_rate", "0/0"))
        is_vfr = bool(avg and r and abs(avg - r) > 0.01)
        return (avg or r), is_vfr
    except Exception as e:
        log.warning(f"ffprobe failed: {e}")
        return None, None


def ensure_cfr(video_path: str, target_fps: Optional[int] = None) -> tuple[str, bool, Optional[float]]:
    """
    Pass-0: transcode to constant-frame-rate (CFR) before analysis.

    Why: OpenCV frame-accurate seeking is unreliable on phone H.264/HEVC (GOP
    keyframe seek), and VFR makes `frame_index/fps` timestamps wrong. A pinned
    CFR transcode makes `t = idx/fps` exact, makes any later dense re-decode
    index-aligned, and produces a byte-stable artifact — the on-chain
    determinism anchor.

    Returns (path_to_use, normalized, detected_fps). Falls back to the ORIGINAL
    path (normalized=False) if disabled, or if ffmpeg is unavailable / fails —
    so the engine still runs (with the VFR caveat) rather than hard-failing.
    The caller owns cleanup of the returned path when normalized=True.
    """
    if not NORMALIZE_CFR:
        return video_path, False, None
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        log.warning("ffmpeg not found — skipping CFR normalization (VFR timestamps may be inaccurate).")
        return video_path, False, None

    src_fps, is_vfr = _probe_fps(shutil.which("ffprobe"), video_path) if shutil.which("ffprobe") else (None, None)
    fps = target_fps or (int(round(src_fps)) if src_fps else 30)
    fps = int(min(max(fps, 1), CFR_MAX_FPS))
    out_path = f"{video_path}.cfr{fps}.mp4"

    base = [ffmpeg, "-nostdin", "-y", "-i", video_path, "-map", "0:v:0", "-vf", "format=yuv420p"]
    # Single-thread + bitexact so the transcode is reproducible on the pinned image.
    # (The on-chain anchor is the decoded frame-stream hash, not these libx264 bytes —
    # see frame_stream_sha256 — but a reproducible encode keeps the decoded pixels stable.)
    tail = [
        "-r", str(fps), "-c:v", "libx264", "-preset", "veryfast",
        "-x264-params", "threads=1:sliced-threads=0:deterministic=1",
        "-threads", "1", "-fflags", "+bitexact", "-flags", "+bitexact",
        "-map_metadata", "-1", "-an", out_path,
    ]
    for rate_flag in (["-fps_mode", "cfr"], ["-vsync", "cfr"]):  # modern flag, then legacy fallback
        try:
            r = subprocess.run(base + rate_flag + tail, capture_output=True, text=True, timeout=300)
            if r.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                log.info(f"CFR-normalized → {fps}fps (src≈{src_fps}, vfr={is_vfr}): {out_path}")
                return out_path, True, float(fps)
            # Only fall through to the legacy flag if THIS flag was rejected by an old
            # ffmpeg; a genuine transcode failure won't succeed on retry — don't re-encode.
            stderr = r.stderr or ""
            if not any(s in stderr for s in ("Unrecognized option", "Option fps_mode not found", "Unknown option")):
                log.warning(f"ffmpeg CFR transcode failed (rc={r.returncode}): {stderr[-400:]}")
                break
        except subprocess.TimeoutExpired as e:
            log.warning(f"ffmpeg CFR timed out ({rate_flag}); not retrying: {e}")
            break
        except Exception as e:
            log.warning(f"ffmpeg CFR error ({rate_flag}): {e}")
            break
    log.warning("ffmpeg CFR normalization failed — using original (un-normalized) video.")
    if os.path.exists(out_path):
        try:
            os.unlink(out_path)
        except OSError:
            pass
    return video_path, False, src_fps
