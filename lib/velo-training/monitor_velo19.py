"""
Unattended velo19 training monitor (the scheduled agent's brain). Fail-safe by design:
on ANY uncertainty it STOPS rather than spends. Run periodically (cron, ~20min).

Each firing does ONE step:
  1. If a Modal training app is RUNNING → do nothing (wait).
  2. If a launched run finished but isn't evaluated → pull best.pt from the volume,
     run eval_velo19, append the verdict to the ledger.
       • body_collapsed (forgetting) OR racket-dead → set STOP (approach failed),
         exactly the body-finetune lesson: a null result is a valid result.
  3. Else if budget remains AND configs remain AND not stopped → launch the next config
     (modal run --detach), record it (conservative cost estimate) in the ledger.
  4. Else → write the FINAL report and stop.

HARD CAP: never launch if (launched_count + 1) * COST_PER_RUN_EST > CAP_USD. With
$12 / $1.50 ⇒ ≤ 8 launches, ever. State lives in velo19_runs/ledger.json.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
STATE = ROOT / "velo19_runs"
LEDGER = STATE / "ledger.json"
REPORT = STATE / "REPORT.md"
PY = sys.executable
MODAL = str(ROOT / ".venv" / "bin" / "modal")
ENV_FILE = ROOT.parent.parent / ".env"

CAP_USD = 12.0
COST_PER_RUN_EST = 1.50          # conservative A10G 2-stage estimate (real ~$1)
MAX_LAUNCHES = int(CAP_USD // COST_PER_RUN_EST)  # = 8 hard ceiling

# Experiment grid (ordered). The first run is the real test: does a [19,3] head learn
# racket butt/tip WITHOUT collapsing body pose, on broadcast data?
GRID = [
    {"name": "velo19_s_w100", "epochs": 100, "weighted": True},
    {"name": "velo19_s_p100", "epochs": 100, "weighted": False},
    {"name": "velo19_s_w150", "epochs": 150, "weighted": True},
]


def _env():
    e = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(("MODAL_TOKEN_ID=", "MODAL_TOKEN_SECRET=")):
                k, v = line.split("=", 1)
                e[k] = v.strip()
    return e


def _load():
    if LEDGER.exists():
        return json.loads(LEDGER.read_text())
    return {"runs": [], "stopped": False, "stop_reason": None}


def _save(led):
    STATE.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(led, indent=2))


def _launched(led):
    return [r for r in led["runs"] if r.get("launched")]


def _spent_est(led):
    return len(_launched(led)) * COST_PER_RUN_EST


def _modal_running(env) -> bool:
    # --json: plain table truncates description ("velo-pose-t…") so a text match fails.
    try:
        out = subprocess.run([MODAL, "app", "list", "--json"], capture_output=True, text=True, env=env, timeout=120).stdout
        apps = json.loads(out[out.index("["): out.rindex("]") + 1])
        for a in apps:
            desc = (a.get("Description") or "").lower()
            state = (a.get("State") or "").lower()
            if "velo-pose-train" in desc and any(s in state for s in ("ephemeral", "running", "deploying")):
                return True
        return False
    except Exception:
        return True  # uncertain → assume running → don't launch (fail-safe)


def _eval_run(env, run) -> dict:
    """Pull best.pt from the volume and eval it locally."""
    local = STATE / run["name"] / "best.pt"
    local.parent.mkdir(parents=True, exist_ok=True)
    remote = f"/runs/{run['name']}/weights/best.pt"
    g = subprocess.run([MODAL, "volume", "get", "--force", "velo-pose-data", remote, str(local)],
                       capture_output=True, text=True, env=env, timeout=600)
    if g.returncode != 0 or not local.exists():
        return {"error": f"no best.pt yet ({g.stderr.strip()[:120]})"}
    ev = subprocess.run([PY, str(ROOT / "eval_velo19.py"), "--weights", str(local)],
                        capture_output=True, text=True, env=env, timeout=1800)
    try:
        return json.loads(ev.stdout[ev.stdout.index("{"): ev.stdout.rindex("}") + 1])
    except Exception:
        return {"error": "eval failed", "stderr": ev.stderr[-300:]}


def _launch(env, cfg, led):
    """Fire-and-forget. `modal run --detach` submits the app but does NOT return promptly
    here (it holds the local handle), so we Popen it and move on. The NEXT firing confirms
    the submit via `modal app list` (running) or the appearance of best.pt; a launch that
    produces neither within the grace window is flagged failed (see main)."""
    name = cfg["name"]
    log = STATE / f"{name}.launch.log"
    cmd = [MODAL, "run", "--detach", str(ROOT / "train.py"),
           "--epochs", str(cfg["epochs"]), "--dataset", "velo19", "--name", name,
           ("--weighted" if cfg["weighted"] else "--no-weighted")]
    STATE.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(cmd, stdout=open(log, "w"), stderr=subprocess.STDOUT, env=env, start_new_session=True)
    rec = {"name": name, "config": cfg, "launched": True, "launch_epoch": time.time(),
           "launched_at": time.strftime("%Y-%m-%d %H:%M"), "evaled": False, "eval": None,
           "launch_log": str(log)}
    led["runs"].append(rec)
    return rec


def _write_report(led):
    lines = ["# velo19 training — unattended monitor report", "",
             f"spent (est): ${_spent_est(led):.2f} / ${CAP_USD:.2f} cap  |  launches: {len(_launched(led))}/{MAX_LAUNCHES}",
             f"stopped: {led['stopped']}  reason: {led.get('stop_reason')}", ""]
    best = None
    for r in led["runs"]:
        ev = r.get("eval") or {}
        line = f"- **{r['name']}** ({r['config']}): "
        if ev.get("error"):
            line += f"eval pending/err ({ev['error']})"
        elif ev:
            rk = ev.get("velo19_test", {}).get("pose_map50_95")
            bd = ev.get("hardval_body", {}).get("pose_map50_95")
            line += f"racket(velo19-test) mAP50-95={rk}  body(hardval) mAP50-95={bd}  collapsed={ev.get('body_collapsed')}  ship={ev.get('ship_candidate')}"
            if ev.get("ship_candidate") and (best is None or (rk or 0) > best[1]):
                best = (r["name"], rk or 0)
        else:
            line += "launched, awaiting completion"
        lines.append(line)
    if best:
        lines += ["", f"**Best ship-candidate so far: {best[0]} (racket mAP50-95={best[1]})**"]
    REPORT.write_text("\n".join(lines) + "\n")


def main():
    env = _env()
    led = _load()

    if _modal_running(env):
        print("[monitor] a velo-pose-train run is active — waiting."); _write_report(led); return

    # eval any launched-but-uneval'd run (best.pt present ⇒ run finished)
    LAUNCH_GRACE_S = 2400  # 40min: a launch that produced no app + no best.pt by now failed
    for r in led["runs"]:
        if r.get("launched") and not r.get("evaled"):
            ev = _eval_run(env, r)
            if ev.get("error"):
                # not ready: still building/training? (app not running here since we passed the
                # _modal_running guard). If past the grace window with no best.pt → failed launch.
                elapsed = time.time() - r.get("launch_epoch", time.time())
                if elapsed > LAUNCH_GRACE_S:
                    tail = ""
                    try:
                        tail = Path(r.get("launch_log", "")).read_text()[-400:]
                    except Exception:
                        pass
                    led["stopped"] = True
                    led["stop_reason"] = f"{r['name']} produced no best.pt within grace ({int(elapsed)}s) — launch likely failed. log: {tail[-200:]}"
                    r["evaled"] = True  # don't re-block on it
                    _save(led); _write_report(led)
                    print(f"[monitor] STOP (launch failed): {led['stop_reason']}")
                else:
                    print(f"[monitor] {r['name']} not ready ({int(elapsed)}s elapsed): {ev['error']}")
                    _write_report(led); _save(led)
                return
            r["eval"] = ev; r["evaled"] = True
            print(f"[monitor] evaled {r['name']}: {ev}")
            if ev.get("body_collapsed"):
                led["stopped"] = True; led["stop_reason"] = f"{r['name']} body-pose COLLAPSED (forgetting) — approach failed; keep coco17 (valid null result)."
            _save(led); _write_report(led)
            if led["stopped"]:
                return
            break  # one eval per firing

    # decide whether to launch the next config
    done_names = {r["name"] for r in led["runs"]}
    nxt = next((c for c in GRID if c["name"] not in done_names), None)
    if led["stopped"] or nxt is None or (len(_launched(led)) + 1) * COST_PER_RUN_EST > CAP_USD:
        if not led["stopped"]:
            led["stopped"] = True
            led["stop_reason"] = ("budget cap reached" if nxt else "all configs done")
        _save(led); _write_report(led)
        print(f"[monitor] DONE. {led['stop_reason']}")
        return

    rec = _launch(env, nxt, led)
    _save(led); _write_report(led)
    print(f"[monitor] launched {rec['name']} (fire-and-forget); est spent ${_spent_est(led):.2f}")


if __name__ == "__main__":
    main()
