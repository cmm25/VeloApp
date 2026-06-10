"""
MLLM data-quality gatekeeper (OFF-CHAIN, provider-agnostic).

Why off-chain: Somnia's native LLM agent is `inferChat(string,string)->string` — TEXT ONLY
(see lib/velo-agents/src/ai/somnia-agents.ts:41), so it cannot see frames. The gatekeeper
must look at pixels, so it runs off-chain on a cheap MULTIMODAL model. (If you want a Somnia
showcase, route a *runtime* quality verdict through Somnia's JSON-API agent → an endpoint that
wraps this module; that's a separate, optional integration — see CODEX-SPEC-3 §5c.)

Provider-agnostic by design — DeepSeek V4 (Flash), Gemini 2.5 Flash-Lite, OpenAI, and OpenRouter
all speak the OpenAI chat-completions format with image_url content. Configure via env:

    GATEKEEPER_API_KEY   = <your key>            # REQUIRED to go live (else mock mode)
    GATEKEEPER_BASE_URL  = https://generativelanguage.googleapis.com/v1beta/openai/   # Gemini (VISION ✅)
    GATEKEEPER_MODEL     = gemini-2.5-flash-lite # cheap multimodal; verify id on provider docs

VERIFIED 2026-06-02: DeepSeek's API (api.deepseek.com; models deepseek-v4-flash / deepseek-v4-pro) is
TEXT-ONLY — it REJECTS `image_url` content ("unknown variant `image_url`"). So DeepSeek CANNOT run this
vision gatekeeper. Use Gemini 2.5 Flash-Lite (above) or OpenAI gpt-4o-mini / OpenRouter for the image
stages. A DeepSeek key is fine for TEXT roles only. With no working multimodal provider it runs MOCK.

Pipeline (cost-minimising — most frames never hit the MLLM):
  Stage 0  pose-confidence pre-filter (FREE) — pseudo_label.py already gates on mean kpt-conf;
           only the borderline "review" frames reach the MLLM here.
  Stage 1  binary frame gate     — player visible / sharp / single foreground player?
  Stage 2  Set-of-Mark skeleton  — render numbered joints on the frame, ask anatomical plausibility.
  (Human spot-check 2–5% of MLLM-passed frames — the MLLM is a filter, not ground truth.)

Usage:
  python gatekeeper.py --review-dir data/pseudo/review     # triage pseudo_label's review queue
  python gatekeeper.py --images some/dir --out data/gated  # gate an arbitrary frame dir
"""

import argparse
import base64
import json
import os
import re
import shutil
from pathlib import Path

COCO17 = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder",
          "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
          "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"]


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


def _api_key() -> str | None:
    _load_dotenv()
    for var in ("GATEKEEPER_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"):  # DeepSeek excluded: text-only
        if os.environ.get(var):
            return os.environ[var]
    return None


def _b64(path: Path) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


# ── Provider: OpenAI-compatible multimodal client, with a deterministic mock fallback ──
class MLLM:
    def __init__(self):
        self.key = _api_key()
        self.base_url = os.environ.get("GATEKEEPER_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
        self.model = os.environ.get("GATEKEEPER_MODEL", "gemini-2.5-flash-lite")
        self.mock = self.key is None
        self.provider_errors = 0
        self.client = None
        if not self.mock:
            try:
                from openai import OpenAI
                self.client = OpenAI(api_key=self.key, base_url=self.base_url)
            except Exception as e:
                print(f"[gatekeeper] openai SDK unavailable ({e}); falling back to MOCK mode.")
                self.mock = True

    def ask(self, prompt: str, image_path: Path) -> dict:
        if self.mock:
            # Deterministic offline stand-in so the pipeline runs without a key.
            return {"_mock": True, "pass": True, "plausible": True, "visible": True,
                    "sharp": True, "single_player": True, "suspect_joints": [],
                    "note": "MOCK verdict (no GATEKEEPER_API_KEY set)"}
        msg = [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{_b64(image_path)}"}},
        ]}]
        try:
            r = self.client.chat.completions.create(
                model=self.model, messages=msg, temperature=0, max_tokens=300,
                response_format={"type": "json_object"},
            )
        except Exception:
            # Some compat endpoints reject response_format. If the endpoint is
            # text-only and rejects image_url content too, keep the pipeline
            # runnable but mark the verdict as mock rather than pretending it
            # was a live vision review.
            try:
                r = self.client.chat.completions.create(
                    model=self.model, messages=msg, temperature=0, max_tokens=300)
            except Exception as e:
                self.provider_errors += 1
                return {"_provider_error": True, "pass": False, "plausible": False, "visible": False,
                        "sharp": False, "single_player": False, "suspect_joints": [],
                        "note": f"provider rejected multimodal request: {type(e).__name__}"}
        return _extract_json(r.choices[0].message.content or "")


FRAME_PROMPT = (
    "You are a strict data-quality filter for a tennis pose-estimation training set. "
    "Look at this frame and reply with ONLY a JSON object: "
    '{"visible": bool, "sharp": bool, "single_player": bool, "racket_visible": bool}. '
    "visible = one primary player's torso and limbs are clearly in-frame and not heavily occluded; "
    "sharp = joints are discernible (not motion-blurred into ambiguity); "
    "single_player = exactly one prominent foreground player (a distant coach/ball-kid does not count)."
)

SKELETON_PROMPT = (
    "This tennis frame has predicted skeleton joints drawn as numbered dots (COCO-17 order: "
    "0 nose, 5/6 shoulders, 7/8 elbows, 9/10 wrists, 11/12 hips, 13/14 knees, 15/16 ankles). "
    "Judge anatomical plausibility and reply with ONLY JSON: "
    '{"plausible": bool, "suspect_joints": [int], "note": str}. '
    "Implausible = wrists(9,10) on legs/background instead of near the hands, ankles(15,16) not near "
    "the ground/feet, or limb dots forming impossible crossings over the torso."
)


def render_som(image_path: Path, label_path: Path, out_path: Path) -> bool:
    """Draw numbered COCO-17 joints (Set-of-Mark) from a YOLO-pose label onto the frame."""
    import cv2
    img = cv2.imread(str(image_path))
    if img is None:
        return False
    h, w = img.shape[:2]
    toks = label_path.read_text().split()
    if len(toks) < 5 + 17 * 3:
        return False
    kp = toks[5:5 + 17 * 3]
    for j in range(17):
        x, y, v = float(kp[3 * j]) * w, float(kp[3 * j + 1]) * h, kp[3 * j + 2]
        if v == "0":
            continue
        cv2.circle(img, (int(x), int(y)), 4, (0, 255, 0), -1)
        cv2.putText(img, str(j), (int(x) + 4, int(y) - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1, cv2.LINE_AA)
    cv2.imwrite(str(out_path), img)
    return True


def triage_review_dir(review: Path, mllm: MLLM) -> dict:
    """Triage pseudo_label.py's review queue: frame.jpg + frame.guess.txt."""
    accepted, flagged, som_dir = review.parent / "gate_accepted", review.parent / "gate_flagged", review / "_som"
    for d in (accepted, flagged):
        if d.exists():
            shutil.rmtree(d)
    for d in (accepted / "images", accepted / "labels", flagged, som_dir):
        d.mkdir(parents=True, exist_ok=True)
    stats = {"total": 0, "accepted": 0, "flagged": 0, "mock": mllm.mock, "provider_errors": 0}
    exts = {".jpg", ".jpeg", ".png"}
    for img in sorted(p for p in review.glob("*") if p.suffix.lower() in exts):
        guess = review / f"{img.stem}.guess.txt"
        stats["total"] += 1
        frame_v = mllm.ask(FRAME_PROMPT, img)
        stats["mock"] = mllm.mock
        stats["provider_errors"] = mllm.provider_errors
        ok_frame = all(frame_v.get(k, False) for k in ("visible", "sharp", "single_player"))
        ok_skel = True
        if guess.exists():
            som = som_dir / img.name
            if render_som(img, guess, som):
                ok_skel = mllm.ask(SKELETON_PROMPT, som).get("plausible", False)
                stats["mock"] = mllm.mock
                stats["provider_errors"] = mllm.provider_errors
        if ok_frame and ok_skel and guess.exists():
            (accepted / "images" / img.name).write_bytes(img.read_bytes())
            (accepted / "labels" / f"{img.stem}.txt").write_text(guess.read_text())
            stats["accepted"] += 1
        else:
            (flagged / img.name).write_bytes(img.read_bytes())
            stats["flagged"] += 1
    (review.parent / "gate_manifest.json").write_text(json.dumps(stats, indent=2))
    print("\n──────────── GATEKEEPER REPORT ────────────")
    for k, v in stats.items():
        print(f"  {k:10s} {v}")
    if mllm.mock:
        print("  ⚠ MOCK mode (no API key) — verdicts are stand-ins. Add GATEKEEPER_API_KEY/GEMINI_API_KEY to go live.")
    print(f"  accepted → {accepted}  (fold into data/merged/train) | flagged → {flagged} (human review)")
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--review-dir", help="pseudo_label.py review queue (frame.jpg + frame.guess.txt)")
    ap.add_argument("--images", help="arbitrary frame dir to binary-gate (no skeleton check)")
    ap.add_argument("--out", default="data/gated")
    args = ap.parse_args()
    mllm = MLLM()
    print(f"[gatekeeper] provider={'MOCK' if mllm.mock else mllm.base_url} model={mllm.model}")
    if args.review_dir:
        triage_review_dir(Path(args.review_dir), mllm)
    elif args.images:
        out = Path(args.out)
        (out / "pass").mkdir(parents=True, exist_ok=True)
        (out / "reject").mkdir(parents=True, exist_ok=True)
        n = a = 0
        for img in sorted(p for p in Path(args.images).glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png"}):
            n += 1
            v = mllm.ask(FRAME_PROMPT, img)
            dst = "pass" if all(v.get(k, False) for k in ("visible", "sharp", "single_player")) else "reject"
            a += dst == "pass"
            (out / dst / img.name).write_bytes(img.read_bytes())
        print(f"[gatekeeper] {a}/{n} passed → {out}")
    else:
        raise SystemExit("provide --review-dir or --images")


if __name__ == "__main__":
    main()
