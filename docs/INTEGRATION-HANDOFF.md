# Velo — Integration Handoff (for full-project integration planning)

**You are picking up to plan how the NN/engine work integrates into the full Velo project.**
This is the single entry point. Read this, then the referenced docs. Everything below is
implemented + committed on a branch but **not yet pushed or merged to `main`**, and one
productization step (engine fusion of the racket model) is not done.

---

## 1. Git state (read carefully — this is the integration crux)

- **`feature-nn-engine-v2`** @ `55cbfc9d` — all the work below. **6 commits ahead of `origin/main`, NOT pushed.** Branched off `origin/main` @ `f74d575d`.
- **`feature-nn`** @ `37434ec4` — a pre-integration safety snapshot of the raw v2 engine working tree.
- **`origin/main`** — Craig's track (bounty/agent/contract deploy work). **It has very likely moved past `f74d575d` since the branch point** — re-check `git log origin/main` before planning the merge.
- Commit chain on `feature-nn-engine-v2`: `2077883e` v2 telemetry + Craig-factory integration → `9a21a9fb` determinism → `77e54deb` velo19 null + report → `b77824de` racket pipeline → `53752704` monitor fix → `55cbfc9d` racket-head result.
- **Rule honored so far: never pushed.** Pushing / PR / merge is a human decision.

The integration is **not a line-merge** — `feature-nn-engine-v2` rebuilt `main.py`/`models.py`/`factory.py` on the v2 nested telemetry; Craig's `main` is on the older flat shape. Plan the merge as a deliberate reconciliation (see `ENGINE-V2-INTEGRATION.md` §1).

## 2. What is DONE (implemented + committed, not shipped)

1. **Engine v2.1 telemetry + honesty layer** — `TennisTelemetry` v2 (nested, camelCase, `by_alias`), wired into Craig's analyzer factory; mediapipe/custom demoted to 501; `wristIsProxy`/`velocityScaleSource`/`timingResolvable` honesty flags. Honest kinematic-sequence (speed-gain primary; coarse hips-before-arm gated). Two-pass CFR decode. Validity gates. (`2077883e`)
2. **Determinism — shipped + PROVEN.** Byte-identical `telemetryHash` across fresh processes and `OMP=1` vs `8` (measured same-arch keypoint drift = 0 px). Pin single-thread+seed+deterministic; canonical sorted/rounded JSON hash + provenance (weights SHA, lib versions); tracker reset + pinned BoT-SORT yaml; round-keypoints-before-geometry; explicit tie-breaks. `test_determinism.py` green. **Honest scope: reproducible on the same pinned arch/image, not arbitrary CPUs.** (`9a21a9fb`)
3. **Agent contract migrated** — the live agent path was broken against v2 (flat fields moved under `summary`). Fixed via a shared `lib/velo-agents/src/ai/normalize-telemetry.ts` used by BOTH `form-agent` and `bounty-agent`; optional v2 Zod fields; prompt gains hard measurement caveats. v1/mock back-compat preserved. (in `2077883e` + `53752704`)
4. **velo19 racket experiment** — single `[19,3]` head: **null** (racket 0.642 but body pose collapsed 0.105). Separate racket-only `[5,3]` model: **WORKS** — racket mAP50-95 **0.619**, box 0.893, **body untouched** (no collapse). Best weights at `lib/velo-training/racket_runs/racket_960_w/best.pt` (+ Modal volume `/runs/racket_960_w`). (`77e54deb`/`b77824de`/`55cbfc9d`)

## 3. What is NOT done (the integration backlog)

- **Engine fusion of the racket model (productize the win).** Run the racket `[5,3]` model as a second analyzer beside stock coco17; associate racket→player; populate `racket_tip`/`racket_butt` (idx 17/18) + `racket_face_deg`; flip `KeypointSpec.indexing="velo19"`, `EngineInfo.racket_keypoints=True`. Body telemetry stays byte-identical → keeps Phase-1 determinism. Then upgrade wrist-proxy → true wrist-snap. **Not started.**
- **Merge `feature-nn-engine-v2` → `main`** reconciling Craig's current `main` (engine factory, agent contract, deploy config). Decide PR strategy.
- **Deploy.** Dockerfile is v2-ready (ffmpeg, CPU torch, pre-baked weights). The racket model adds a second weights file + inference pass.
- **Phone-clip hardval** — no phone-domain eval exists; no absolute phone accuracy for body OR racket. Everything trained/eval'd on broadcast.

## 4. Open risks / decisions for the integration plan

- **R1 (top): Koyeb CPU latency is UNMEASURED.** Gates the dense pass + the yolo11l swap + now the *second* (racket) inference pass. Local bench: yolo11s ≈80 ms, yolo11l ≈221 ms/frame; a 10 s clip with the dense pass took ~55 s on a fast Mac. Two inference passes (body + racket) roughly doubles cost. **Benchmark on the real Koyeb instance before shipping; likely default `DENSE_STROKE_WINDOW=0` there.**
- **Determinism cross-arch:** committed model is "reproducible in the pinned canonical container." Decide/declare the canonical arch + image digest for the on-chain audit.
- **Racket head: broadcast→phone transfer unproven** (no phone racket eval). Ship gated behind `racketKeypoints=true`; don't overclaim.
- **yolo11l swap** (+29% hard-case body precision, $0) is a one-line env change but gated on R1.
- **Schema-3-surface sync:** any telemetry change must move `models.py` (Pydantic) + `schemas.ts` (Zod) + the Q-LLM prompt together.

## 5. Reusable assets / file map
- Engine: `lib/velo-engine/src/{determinism.py, yolo_analyze.py, kinematics.py, models.py, video_io.py, analyzer_yolo.py, factory.py, main.py, botsort_pinned.yaml}`; `test_determinism.py`.
- Agent contract: `lib/velo-agents/src/ai/{schemas.ts, normalize-telemetry.ts, prompts.ts}`, `lib/velo-agents/src/agents/{form-agent.ts, bounty-agent.ts}`.
- Training/experiment harness (reusable): `lib/velo-training/{build_racket.py, eval_racket.py, monitor_racket.py, build_velo19.py, eval_velo19.py, monitor_velo19.py, train.py, velo_loss.py}`; results in `lib/velo-training/{racket_runs, velo19_runs}/`.
- Modal: volume `velo-pose-data` (datasets `/velo19`, `/racket`; runs `/runs/...`). Tokens `MODAL_TOKEN_ID/SECRET` in repo `.env` (Modal CLI ignores `.env` — export first).

## 6. Suggested deep-planning agenda (for the new chat)
1. **Merge strategy** `feature-nn-engine-v2` → `main`: diff against current `origin/main`, decide reconciliation (likely a fresh integration branch re-applying v2 on top of latest main, not a raw merge).
2. **Engine fusion** of the racket head: where the second analyzer lives, racket→player association, telemetry population, determinism preserved.
3. **R1 Koyeb benchmark** + the ship/defer matrix (dense pass, yolo11l, racket pass).
4. **Deploy + on-chain**: declare canonical arch/image; commit `telemetryHash` path.
5. **Phone hardval** plan (the real accuracy gap).

---

## 7. Reference docs to load (attach these to the new chat)
- `docs/INTEGRATION-HANDOFF.md` (this file — start here)
- `docs/VELO-NN-MASTER-LOG.md` (decisions, determinism analysis, roadmap)
- `docs/VELO-NN-PROGRESS-REPORT.md` (full progress/research report — Phase 1 + Phase 2 + option 1)
- `docs/GEMINI-DETERMINISM-HANDOFF.md` (the determinism problem statement + Gemini's math)
- `lib/velo-engine/docs/ENGINE-V2-INTEGRATION.md` (engine v2 design + risk register + the merge §1)
- `lib/velo-engine/docs/CODEX-SPEC-3-finetune-autoannotation.md` (P2 racket/velo19 spec)
- `lib/velo-training/docs/ITERATION-LOG.md` (finetune history + stock zoo)
- Folders to skim: `lib/velo-engine/src/`, `lib/velo-agents/src/ai/` + `src/agents/`, `lib/velo-training/`
