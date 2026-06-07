"""
Unattended monitor for the SEPARATE racket head (option 1). Same fail-safe design as
monitor_velo19.py: Popen launch (modal run --detach doesn't return promptly), confirm via
app-list/best.pt, hard budget cap, write REPORT. Body cannot collapse (racket-only model),
so the adaptive stop is on "detector can't find the racket" (full-frame approach failed →
pivot to player-crop), not on body-collapse.

Budget: $10 here (≈$12 total − $1.50 already spent on velo19). imgsz-960 two-stage runs cost
more, so COST_PER_RUN_EST=$3 ⇒ ≤3 launches.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
STATE = ROOT / "racket_runs"
LEDGER = STATE / "ledger.json"
REPORT = STATE / "REPORT.md"
PY = sys.executable
MODAL = str(ROOT / ".venv" / "bin" / "modal")
ENV_FILE = ROOT.parent.parent / ".env"

CAP_USD = 10.0
COST_PER_RUN_EST = 3.0
MAX_LAUNCHES = int(CAP_USD // COST_PER_RUN_EST)
LAUNCH_GRACE_S = 3600  # imgsz-960 two-stage takes longer; allow 60min before flagging failed

GRID = [
    {"name": "racket_960_w", "epochs": 100, "imgsz": 960},   # two-stage, imgsz 960
    {"name": "racket_1280_w", "epochs": 100, "imgsz": 1280},  # bigger if 960 detection weak
]


def _env():
    e = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(("MODAL_TOKEN_ID=", "MODAL_TOKEN_SECRET=")):
                k, v = line.split("=", 1); e[k] = v.strip()
    return e


def _load():
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else {"runs": [], "stopped": False, "stop_reason": None}


def _save(led):
    STATE.mkdir(parents=True, exist_ok=True); LEDGER.write_text(json.dumps(led, indent=2))


def _launched(led):
    return [r for r in led["runs"] if r.get("launched")]


def _spent_est(led):
    return len(_launched(led)) * COST_PER_RUN_EST


def _modal_running(env) -> bool:
    try:
        out = subprocess.run([MODAL, "app", "list"], capture_output=True, text=True, env=env, timeout=120).stdout
        return any("velo-pose-train" in l and ("running" in l.lower() or "ephemeral" in l.lower()) for l in out.splitlines())
    except Exception:
        return True  # uncertain → assume running → don't launch


def _eval_run(env, run) -> dict:
    local = STATE / run["name"] / "best.pt"
    local.parent.mkdir(parents=True, exist_ok=True)
    g = subprocess.run([MODAL, "volume", "get", "--force", "velo-pose-data",
                        f"/runs/{run['name']}/weights/best.pt", str(local)],
                       capture_output=True, text=True, env=env, timeout=600)
    if g.returncode != 0 or not local.exists():
        return {"error": f"no best.pt yet ({g.stderr.strip()[:120]})"}
    ev = subprocess.run([PY, str(ROOT / "eval_racket.py"), "--weights", str(local),
                         "--imgsz", str(run["config"].get("imgsz", 960))],
                        capture_output=True, text=True, env=env, timeout=1800)
    try:
        return json.loads(ev.stdout[ev.stdout.index("{"): ev.stdout.rindex("}") + 1])
    except Exception:
        return {"error": "eval failed", "stderr": ev.stderr[-300:]}


def _launch(env, cfg, led):
    name = cfg["name"]
    log = STATE / f"{name}.launch.log"
    cmd = [MODAL, "run", "--detach", str(ROOT / "train.py"),
           "--epochs", str(cfg["epochs"]), "--dataset", "racket", "--name", name,
           "--no-weighted", "--imgsz", str(cfg["imgsz"])]
    STATE.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(cmd, stdout=open(log, "w"), stderr=subprocess.STDOUT, env=env, start_new_session=True)
    rec = {"name": name, "config": cfg, "launched": True, "launch_epoch": time.time(),
           "launched_at": time.strftime("%Y-%m-%d %H:%M"), "evaled": False, "eval": None, "launch_log": str(log)}
    led["runs"].append(rec)
    return rec


def _write_report(led):
    lines = ["# racket head (option 1) — unattended monitor report", "",
             f"spent (est): ${_spent_est(led):.2f} / ${CAP_USD:.2f}  |  launches: {len(_launched(led))}/{MAX_LAUNCHES}",
             f"stopped: {led['stopped']}  reason: {led.get('stop_reason')}", ""]
    best = None
    for r in led["runs"]:
        ev = r.get("eval") or {}
        s = f"- **{r['name']}** ({r['config']}): "
        if ev.get("error"):
            s += f"awaiting/err ({ev['error']})"
        elif ev:
            s += f"racket mAP50-95={ev.get('racket_map5095')} mAP50={ev.get('racket_map50')} box={ev.get('box_map50')} ship={ev.get('ship_candidate')}"
            if ev.get("ship_candidate") and (best is None or (ev.get('racket_map5095') or 0) > best[1]):
                best = (r["name"], ev.get("racket_map5095") or 0)
        else:
            s += "launched, awaiting completion"
        lines.append(s)
    if best:
        lines += ["", f"**Best racket ship-candidate: {best[0]} (mAP50-95={best[1]})**"]
    REPORT.write_text("\n".join(lines) + "\n")


def main():
    env = _env(); led = _load()
    if _modal_running(env):
        print("[racket] a run is active — waiting."); _write_report(led); return

    for r in led["runs"]:
        if r.get("launched") and not r.get("evaled"):
            ev = _eval_run(env, r)
            if ev.get("error"):
                elapsed = time.time() - r.get("launch_epoch", time.time())
                if elapsed > LAUNCH_GRACE_S:
                    led["stopped"] = True
                    led["stop_reason"] = f"{r['name']} no best.pt within grace ({int(elapsed)}s) — launch failed."
                    r["evaled"] = True; _save(led); _write_report(led)
                    print(f"[racket] STOP (launch failed): {led['stop_reason']}")
                else:
                    print(f"[racket] {r['name']} not ready ({int(elapsed)}s): {ev['error']}"); _save(led); _write_report(led)
                return
            r["eval"] = ev; r["evaled"] = True
            print(f"[racket] evaled {r['name']}: {ev}")
            if ev.get("too_small_fail"):
                led["stopped"] = True
                led["stop_reason"] = f"{r['name']} box mAP50={ev.get('box_map50')} — detector can't localize the racket at full-frame. Pivot to player-crop racket model."
            _save(led); _write_report(led)
            if led["stopped"]:
                return
            break

    done = {r["name"] for r in led["runs"]}
    nxt = next((c for c in GRID if c["name"] not in done), None)
    if led["stopped"] or nxt is None or (len(_launched(led)) + 1) * COST_PER_RUN_EST > CAP_USD:
        if not led["stopped"]:
            led["stopped"] = True; led["stop_reason"] = ("budget cap" if nxt else "all configs done")
        _save(led); _write_report(led); print(f"[racket] DONE. {led['stop_reason']}"); return

    rec = _launch(env, nxt, led)
    _save(led); _write_report(led)
    print(f"[racket] launched {rec['name']} (fire-and-forget); est spent ${_spent_est(led):.2f}")


if __name__ == "__main__":
    main()
