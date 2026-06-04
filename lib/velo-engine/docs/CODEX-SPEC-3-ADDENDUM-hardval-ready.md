# CODEX SPEC-3 ADDENDUM — hardval_gold is HUMAN-VERIFIED; finetune + observe

**Date:** 2026-06-03. **Branch:** `feature-nn`. **Reads with:** `CODEX-SPEC-3-finetune-autoannotation.md`.
**Git rule (hard, unchanged):** you may `git pull` but **NEVER push**; no `git stash`/`merge`/`rebase`.
Secrets live in repo-root `.env` — reference by name, never print or commit.

This addendum records what changed since SPEC-3 was written: **STEP 1 and STEP 2 are now DONE.**
Your job starts at STEP 3.

---

## What is now done (do not redo)

**STEP 1 — baseline & dataset:** reproduced. `data/merged/` is the leakage-safe COCO-17 set.

**STEP 2 — the HARD eval set is built AND human-verified.** This was the blocker; it is cleared.
- `lib/velo-training/data/hardval_gold/` — 60 hard frames (Mixkit clips 869/873/876/877), reviewed
  frame-by-frame by a human in Label Studio. Corrections were merged over the strong `yolo11x-pose`
  draft and exported to `labels/test/` by `lib/velo-training/export_hardval_gold.py`.
- Status in `PROVENANCE.md` = **HUMAN_VERIFIED** (read its **Label Semantics** section in full).
- It is **recall-light / kinetic-chain-focused**: mean 9.9/17 joints labeled per frame (shoulder/
  elbow/wrist/hip prioritised; occluded peripherals left `v=0`, which OKS ignores). All 21
  zero-correction frames were eyeballed — every draft skeleton lands on the athlete's body.

### The gate you must beat (measured 2026-06-03, stock `yolo11s-pose` on hardval_gold/test)

| metric | stock on **hardval_gold** | stock on easy clean val | meaning |
|---|---|---|---|
| `pose_mAP50` | **0.7618** | 0.959 | the hard set is genuinely harder ✔ |
| `pose_mAP50-95` | **0.4660** | 0.515 | **the precision number to beat — the real win** |
| `box_mAP50` | 0.9656 | 0.786 | detection is fine |

**Ship the finetune ONLY if it beats BOTH `0.7618` and `0.4660` on `hardval_gold/test`.** Parity on
the easy val is expected and is NOT a ship reason. `pose_mAP50-95` (precision) is where a finetune earns
its keep. Use the set for the **relative** decision; do not quote its absolute OKS as clean ground truth
(see Label Semantics — accepted-draft frames bias absolute OKS upward, equally for both models).

Reproduce the gate any time:
```bash
cd lib/velo-training
.venv/bin/python eval_pose.py --data data/hardval_gold/data.yaml --split test
```

---

## Your job (STEP 3 → 6), in order, gating each step

### STEP 3 — scale training data + let the observer observe
- Grow `data/merged/train` with pseudo-labeled HARD footage (raw clips / THETIS frames), via
  `pseudo_label.py` (top-down pose → conf-gated COCO-17). **Never** let any `hardval_gold` source clip
  (869/873/876/877) leak into train.
- **The "observer" is live-configured** — run it, don't leave it in MOCK. `.env` already has
  `GATEKEEPER_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`,
  `GATEKEEPER_MODEL=gemini-2.5-flash-lite`, `GATEKEEPER_API_KEY`, and `openai` is installed in
  `lib/velo-training/.venv`. So `gatekeeper.py` runs **Gemini 2.5 Flash-Lite** as the vision data-quality
  gate over `pseudo_label.py`'s review queue. (Reminder: DeepSeek's API is TEXT-ONLY — it CANNOT see
  frames; the `DEEPSEEK_API_KEY`/`GROQ_API_KEY` power text roles only.) Confirm one live call, then run.
- The observer **validates/flags only** — it never invents coordinates and never auto-deletes; FAIL
  routes to human. Spot-check 2–5% of passed frames.

### STEP 4 — finetune (MODAL ONLY — do NOT train locally)
- **HARD CONSTRAINT: this machine is an 8 GB Apple M2. Local/MPS training OOMs at any useful batch
  and is NOT a viable path — do not attempt it, do not "work around" it by shrinking batch/recipe.**
  A prior attempt burned hours on MPS batch 8→32; that is a confirmed dead end. `--local` / `--device mps`
  are for a tiny smoke test ONLY, never a real run.
- **Prerequisite (human, one-time): Modal must be authenticated** (`~/.modal.toml`). If it is missing,
  STOP and ask Eshaan to run `.venv/bin/modal setup` (browser auth) — Codex cannot do browser auth.
  `modal` 1.4.3 is already installed in `lib/velo-training/.venv`.
- Once authed, run the designed cloud path (A10G, ~$6, inside the $30 free Starter credit):
  ```bash
  cd lib/velo-training
  .venv/bin/modal volume put velo-pose-data data/merged /merged   # one-time data upload
  .venv/bin/modal run train.py --epochs 100 --batch 16            # 2-stage, --baseline default True
  ```
- `train.py`'s Modal entrypoint (`train_modal`, `gpu="A10G"`, volume `velo-pose-data` at `/vol`) is intact.
  Recipe in SPEC-3 §6a. `best.pt` lands on the volume — pull it back before STEP 5/6.
- Fallback if Modal is refused: free Colab T4 (upload `data/merged`, run the same recipe). Still NOT local M2.

### STEP 5 — evaluate honestly & decide
```bash
.venv/bin/python eval_pose.py --data data/merged/data.yaml     --finetuned runs/velo-pose/weights/best.pt --split val
.venv/bin/python eval_pose.py --data data/hardval_gold/data.yaml --finetuned runs/velo-pose/weights/best.pt --split test
```
Ship only if it beats stock on `hardval_gold` (both `pose_mAP50` > 0.7618 AND `pose_mAP50-95` > 0.4660)
and does not regress >0.01 on the easy val. **If it does not beat stock, say so and keep stock** — that is
a valid, honest result and the deterministic pipeline is still the pitch.

### STEP 6 — engine integration + deliverable
```bash
export YOLO_WEIGHTS=$(pwd)/runs/velo-pose/weights/best.pt
cd ../velo-engine && .venv/bin/python verify_engine.py    # schema-valid v2 telemetry?
```
Write `lib/velo-training/compare_report.md`: stock vs finetune on **both** splits, the SHIP/NO-SHIP
verdict, 4–6 overlay frames (incl. an occluded one), the honest target table, and the observer's
accept/flag counts. **Prepare the diff for Eshaan to push — do NOT push.**

