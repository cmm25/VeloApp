# Velo Integration Plan (feature-nn-engine-v2 → main)

> Generated 2026-06-07 from a 13-agent deep-planning workflow (6 areas × recon→adversarial-critique → synthesis). PLAN ONLY — nothing merged, no code changed.
> Initial user direction: (1) build racket fusion first, (2) deploy to Koyeb, (3) "perfect fit" with the real upstream/downstream flow.
>
> ## ✅ DECISIONS LOCKED (2026-06-07, after the deep analysis)
> - **D4 → DEFER racket.** Ship the body engine + the on-chain hash fix first; racket is a gated R1 follow-up.
> - **D3 → pure v2 form-agent path.** Engine drops in behind `VISION_ENGINE_URL` (already wired). The external-ai-models branch is dropped from the production path (it validates v1 schema + has a skill collision).
> - **D6 → REVISED (2026-06-07): NO contract change.** Commit `telemetryHash` via the EXISTING `summaryHash`+IPFS path (the receipt already pins+hashes the report; just stop dropping the hash in `normalize-telemetry.ts`). The dedicated `bytes32` field is **rejected** — the migration workflow confirmed it's a 2-contract redeploy of immutable contracts (new addresses, breaks Craig's live wiring, 4 type-hash copies). **Fix applied + verified (R2 closed). See `docs/VELO-ONCHAIN-HASH-MIGRATION.md`.**
> - Deploy target: **Koyeb** (eco-vs-paid deferred to the R1 bench; paid/always-on likely required).

## ⚠️ TENSIONS with the stated plan (read first)
1. **Racket-first is risky.** Analysis strongly recommends DEFER (ship body engine first, racket as a gated follow-up). Reasons: no determinism test for racket-on body bytes exists yet (the current gate is vacuous), it ~doubles inference on an unmeasured Koyeb CPU, `racketFaceDeg` isn't even rendered to the LLM today, and phone racket is the most likely thing to collapse. **Your call — re-decide with this info.**
2. **The on-chain determinism headline is currently false (R2, blocker).** `telemetryHash` is computed by the engine then thrown away before chain. The bigger deployable win is the honest body engine + closing this gap — not racket.
3. **The external-ai-models branch can't even test the v2.1 engine yet** (it validates the OLD v1 schema and would reject v2.1 output; plus a skill collision). The "perfect fit" is the **v2 form-agent path**, already wired. External branch = plumbing smoke test only, after a v1→v2 port.
4. **The on-disk "phone clip" is unusable** — it's a Google-Meet screen recording of a Velo dev session, zero tennis. Real footage must be captured.

---

## 0. TL;DR — can it deploy, and what is the critical path

**Yes, the engine can deploy today** as a standalone FastAPI service (`lib/velo-engine/Dockerfile`, YOLO body-only, stock `yolo11s-pose.pt`) consumed by the v2 form-agent via `VISION_ENGINE_URL` + `VISION_MODE=live`. It emits caveated, non-fabricating TennisTelemetry v2.1 with a real deterministic `telemetryHash`. The merge into a branch off current `origin/main` is **clean** (4-file intersection, 2 trivial conflicts).

**But the headline on-chain claim does not exist in shipped code.** The deterministic `telemetryHash` is computed by the engine (`yolo_analyze.py:775`) and then **thrown away** by the agent — `grep telemetryHash lib/velo-agents/src` returns zero hits; `normalize-telemetry.ts:21-31` drops it, and the on-chain `summaryHash = keccak256(reportBytes)` (`form-agent.ts:84-87`, `eip712.ts:119`) commits a hash of JSON that **includes the non-deterministic Groq formReport**. So "reproducible on-chain commitment to the deterministic vision output" is currently false. (Verified.)

**Critical path to an honest deploy (3 items, none requiring R1):**
1. **Merge** feature → fresh branch off `origin/main` (clean; fix the `.gitignore` footgun + correct the verify gate).
2. **Plumb `telemetryHash` to chain** (agent-side: `schemas.ts` + `normalize-telemetry.ts` + `form-agent.ts` + `eip712.ts`).
3. **Pin the canonical image** (`FROM --platform=linux/amd64` + base digest) and **generate the reference hash twice inside that amd64 image** — never reuse the arm64 dev-box hash.

**BLOCKED-ON-R1 (defer until Koyeb is measured):** dense pass on Koyeb, `yolo11l` swap, racket fusion. Ship body-only `yolo11s`, coarse, first.

---

## 1. Sequenced execution order

> **[R1]** = blocked on Koyeb benchmark. **[CHAIN]** = touches on-chain commitment. **[CODE]** = not config-only.

1. **Materialize the merge** on a fresh branch off current `origin/main`. Resolve the 2 conflicts (`.gitignore`, `lib/velo-engine/README.md`) **on disk**. **[CODE]**
2. **Fix `.gitignore` resolution** (do NOT blindly keep main's `docs/` line — see §2.1). Verify `git check-ignore docs/NEW-HANDOFF.md` returns nothing.
3. **Build + typecheck** `lib/velo-agents` (`tsc` strict is the two-owner schema gate). **Human-read** merged `prompts.ts`.
4. **Grep-verify the CORRECT tokens** — TS honesty fields `wristIsProxy, racketFaceDeg, velocityScaleSource, timingGranularityMs, normalizedCfr, kinematicSequenceValid, sequenceCoherenceScore, peakProximalToDistalGain` in `schemas.ts:13-62`, plus Craig's `TechniqueReferenceSchema/SomniaAgentReceiptSchema/StoredReceiptSchema`. (Python tokens `telemetryHash/keypointSpec/racketKeypoints` live in `models.py`, not TS — gating on them silently false-passes.)
5. **Smoke-test agent boot under the ACTUAL deploy command** (`node dist/index.js`, not `tsx`). `config.ts` `path.resolve(__dirname,'../../../.env')` resolves to `lib/.env` from `dist/utils` (wrong) vs `lib/velo-agents/.env` from `src/utils` (right). Requires a real `lib/velo-agents/.env`. **[CODE]**
6. **Plumb `telemetryHash` → chain** (`schemas.ts` add field, `normalize-telemetry.ts:21-31` graft, `form-agent.ts:84-99` into reportPayload + receipt summary). **[CHAIN][CODE]**
7. **Pin canonical image**: `FROM --platform=linux/amd64` + base digest in `Dockerfile:1`; declare `{imageDigest, platform, weights_sha256, lib_versions}` in `docs/DEPLOY.md`. **[CODE]**
8. **Two-run amd64 reproducibility check**: generate `telemetryHash` twice inside the pinned amd64 image, assert byte-identical, before declaring any on-chain reference hash. (The digest anchors *which* artifact; it does **not** prove the `round_keypoints` cross-arch buffer, `determinism.py:38,110-114`, holds.)
9. **Clean up `render.yaml`** (remove dead `ANALYZER_BACKEND=mediapipe`/`MEDIAPIPE_MODEL_COMPLEXITY`; hygiene, not a blocker). **[CODE]**
10. **Deploy body-only `yolo11s` coarse**; wire `VISION_ENGINE_URL` + `VISION_MODE=live` on the runner.
11. **[R1] Run the Koyeb benchmark protocol** (§2.3) — latency **and memory**, cold vs warm, per-stage, re-run `test_determinism.py` on the image.
12. **[R1] Decide** dense default, `yolo11s`-vs-`yolo11l`, multi-thread relaxation.
13. **[R1] Racket fusion** (§2.2) — author the new determinism regression FIRST; ships OFF by default.
14. **Phone hardval** (§2.5) — POST-deploy; starts with **capturing real footage**.
15. **External-ai-models** (§2.6) — smoke test only, after the v2 schema is ported onto that branch. Not on the production path.

---

## 2. Per-area plans

### 2.1 Merge
**Verified clean.** Touched-file intersection is exactly four: `.gitignore`, `lib/velo-agents/src/ai/prompts.ts`, `schemas.ts`, `lib/velo-engine/README.md`. `merge-tree` reports conflicts only in `.gitignore` and the engine README. Engine `src/*` has **zero** conflicts — main never touched it, so determinism artifacts can't be perturbed by the merge. `schemas.ts` feature hunks (~≤62) and Craig's (110+) are non-overlapping → merged tree contains both the v2 honesty fields and `TechniqueReferenceSchema`. `models.py` is feature-only. Prescriber consumes `FormReport`, not `TennisTelemetry`; feature doesn't modify `FormReportSchema`. This is a normal **2-parent merge**, not 3-way; the external branch is NOT a parent.

**`.gitignore` footgun (mustFix):** main's commit `f4523d91` is `-.docs/` `+docs/` — it starts ignoring the tracked `docs/` tree, silently dropping future docs additions. Drop/scope it, union feature's ML-weights block, verify `git check-ignore docs/NEW-HANDOFF.md` is empty.

**Risks:** `config.ts` dist-path env bug is inherited from main (dev smoke test misses it — test the dist invocation); schema-3 now has two owners (document the sync rule); push the integration branch, delete `feature-nn-engine-v2` once landed.

### 2.2 Racket [5,3] fusion (recommended DEFER; ships OFF, [R1]-gated)
**Not wired:** `yolo_analyze.py:741` hardcodes `racket_keypoints=False`, `:291` `racket_face_deg=None`. Model `racket_runs/racket_960_w/best.pt` (19.8MB), pose 1-class `[5,3]`, order `[top,bottom,handle,left,right]`. **Index per `build_velo19.py`: `racket_butt=17, racket_tip=18`** — the shared "17/18" note is REVERSED; follow the builder.

**Plan:** new `lib/velo-engine/src/racket_analyze.py`, env-gated `RACKET_KEYPOINTS`/`RACKET_WEIGHTS` (default OFF). Eager-load racket model in `YoloAnalyzer.__init__` with a 2nd `_RACKET_WEIGHTS_SHA` (don't lazy-load mid-analysis — RNG ordering). **Default to a SEPARATE racket decode pass** (provably body-isolated), not fused into Pass-1 (fusion has zero measured body-byte-invariance evidence). Associate racket→subject by nearest handle-kpt to hitting wrist, gated on `torso_len`, deterministic tie-break. Populate **additively** into summary-level `JointAngles`; flip `indexing="velo19"` + `racket_keypoints=true` + extend `names` only when racket data exists; smooth racket in a SEPARATE array (never widen body `xy_raw/xy_sm` or filtfilt padding could perturb body floats). Add `racket_weights_sha256` to `EngineInfo`. **FAIL CLOSED** if flag on but weights/SHA missing.

**mustFix — the gate is currently vacuous:** `test_determinism.py` never sets a RACKET env, so with off-by-default it tests the identical path and passes trivially. **Author a NEW committed regression**: `RACKET=on`, fresh process, assert the body sub-tree hashes byte-identically to body-only. Until green, do not ship.

**mustFix — wire the consumer:** `prompts.ts:49-60` renders only shoulder/elbow/wrist/hip/knee and never reads racket fields; and `normalize-telemetry.ts:17` surfaces only `summary` fields so contact-frame per-stroke racket angles are dropped. Populate summary `JointAngles` for visibility + add the render.

**Risks:** ~doubles per-frame cost (bound it to contact frames as a 3rd pass); broadcast-only training, contact-frame binds unreliable → proxy fallback; **no ultralytics mismatch** (both pin 8.3.40 — corrected); prebake `best.pt` into the Dockerfile before enabling.

### 2.3 R1 — Koyeb latency + memory benchmark (BLOCKER)
**Binding constraint:** hard agent abort `AbortSignal.timeout(120_000)` at `form-agent.ts:172`/`bounty-agent.ts:202` (hardcoded, no env). **mustFix — nested retry:** outer job `withRetry({attempts:3})` around inner `withRetry({attempts:2})` → analyze runs up to **6×**, worst case ~6×120 s per failing job, hammering one instance. Latency knobs (engine-side env; agents send only `{video_url,video_cid}` so defaults always apply): `DENSE_STROKE_WINDOW` default ON (biggest multiplier, `:81`), `sample_rate=5`, `max_duration_s=45`, `YOLO_WEIGHTS`, CFR transcode (Pass-0). Ground truth: M2 single-thread coarse = 10.4 s/10 s clip, 173 ms/frame.

**Benchmark protocol:** (1) capture exact Koyeb plan — `CODEX-RESEARCH.md:162` warns free box ≈0.1 vCPU/512 MB → **add a memory axis**, OOM may bind before latency. (2) broadcast + real phone clips. (3) cold vs warm (`precheck.ts:113` only probes `/healthz`, not warm `/analyze`). (4) per-stage timing (download/CFR/coarse/dense) + peak RSS + OOM-kills. (5) derive the dense-fit budget: `120 s − download − CFR = residual for pose`. (6) re-run `test_determinism.py` inside the Koyeb image.

**Invariant (mustFix):** single-thread pinning (`determinism.py:59,66,67`) is **hardcoded, not env-gated** — relaxing it is a CODE change, and `torch.set_num_threads(1)` OVERRIDES `OMP_NUM_THREADS` (naive `OMP=8` silently no-ops). Same-arch drift is already 0 across thread counts, so multi-thread wouldn't break same-arch hash — but must be code-gated + verified applied.

> Citation hygiene: prod chain is `main.py` → `analyzer_yolo.py:32` → `yolo_analyze.py:400`. `src/analyze.py` is the DEAD MediaPipe path — do not follow it.

### 2.4 Deploy + on-chain
**The gap (verified headline):** `telemetryHash` computed (`yolo_analyze.py:775`) but never reaches chain — `normalize-telemetry.ts:21-31` excludes it; `summaryHash=keccak256(reportBytes)` hashes JSON including the non-deterministic Groq formReport. The receipt is NOT a reproducible commitment to the vision output.

**Steps:** pin canonical image (`Dockerfile:1` amd64 + digest; declare in `docs/DEPLOY.md`; `weights_sha256`+`lib_versions` already in `EngineInfo`). Close the gap: add `telemetryHash` to `TennisTelemetrySchema`, graft in `normalize-telemetry.ts`, carry into `reportPayload`+`receipt.summary` (`form-agent.ts:84-99`, `eip712.ts:110-131`). `render.yaml` hygiene — the "mediapipe deploy bug" does NOT occur (Dockerfile `ENV VISION_ENGINE=yolo` resolved first; corrected); just delete dead env.

**Cross-arch (mustFix):** dev arm64 vs Koyeb amd64; `round_keypoints` grid unmeasured across arches. Generate the on-chain reference hash with a two-run check inside the amd64 image; never reuse the arm64 dev hash.

**On-chain honesty (mustFix):** embedding `telemetryHash` in `receipt.summary` does land in the EIP-712 signature, but `summary` carries LLM `keyFindings` text → the carrier is non-deterministic; `telemetryHash` is a deterministic substring inside LLM text. A dedicated `bytes32` receipt field is the clean shape (needs a contract migration).

### 2.5 Phone hardval (POST-deploy, not a blocker)
**The on-disk "phone clip" is unusable** — `1280×720/24fps/3383 s`, a Google-Meet screen recording of a Velo dev session, zero tennis; `PROVENANCE.md:31-33` already excludes it. **Correction:** `data/hardval_gold19/` is NOT empty (60 imgs + 60 labels + `[19,3]` data.yaml) — but it's broadcast frames; the phone-domain version is what's missing. Tooling confirmed: `build_hardval_gold.py`, `export_hardval_gold.py`, `pseudo_label.py`, `gatekeeper.py`, `eval_pose.py`, `eval_racket.py`.

**Steps:** (0, BLOCKER) capture 2-4 short single-camera phone clips of one player hitting. Extract ~3 fps. Rank+draft-label body. Human-label kinetic chain in Label Studio — **mustFix:** `export_hardval_gold.py` is hardwired (`GOLD` `:18`, `project_id=1` `:74`) → needs code edits / fresh LS project. Hand-label 5 racket kpts. `eval_pose.py` stock 11s vs 11l on phone gold. `eval_racket.py` (+`--data`) — **pin eval `imgsz` to the engine's actual inference imgsz** (~640, not the 960 default) or it's a model-capability number, not a deployability number.

**Invariant:** never publish an absolute "accuracy %"; pose mAP is a relative localization gate. 2D single-camera transverse-plane angles (pronation/ER/X-factor) are not correctly measured — hard-cap claims.

### 2.6 External-ai-models (smoke test only; needs schema port first)
`external-model.ts` POSTs `{videoUrl,videoCid}`, validates flat `{aspect, metrics:Record<string,number>, observations:string[], confidence?, notes?}`, throws on mismatch. Input matches only because `AnalyzeRequest` is a `CamelModel` with `populate_by_name=True` — load-bearing.

**Critical corrections (blockers):**
- **Skill INVERTED:** do NOT set `EXTERNAL_MODEL_SKILL=vision.pose` — that's the Form agent's `FORM_PRIMARY_SKILL`. Both agents self-filter the same event → double Form-receipt / nonce collision. Use a distinct skill (`vision.serve`/`-ext`).
- **Non-deterministic on-chain hash:** external `summaryHash` is over the LLM-translated FormReport (`temperature:0.3`); schema has no `telemetryHash` field.
- **Branch conflation:** `normalize-telemetry.ts` + v2 honesty schema exist ONLY on `feature-nn-engine-v2`. The external branch validates the OLD v1 `TennisTelemetrySchema` → would REJECT v2.1 output. Port v2 schema/normalizer onto the external branch BEFORE any test.
- **Adapter null-throws:** `metrics` is `z.record(string,number)`; `peakWristVelocityTlPerS`/`sequenceCoherenceScore`/`peakProximalToDistalGain` are null on real clips → Zod throws. Omit null keys.
- **Adapter location:** do NOT flatten in `main.py` (pollutes the deterministic engine boundary) — sidecar/agent layer.
- **Local-CID:** `resolveVideoUrl` returns null for `local:` CIDs → engine 400s; external path has no mock fallback (Form path does). Add one or document IPFS-only.

**Recommendation:** v2 form-agent is the real integration path (zero adapter, already wired, preserves honesty + telemetryHash). External is a plumbing smoke test only, and can't run against v2.1 until the schema port lands.

---

## 3. Consolidated risk register (severity-ranked)

| # | Sev | Risk | Area | Mitigation |
|---|-----|------|------|------------|
| R1 | blocker | Koyeb CPU+memory unmeasured (~0.1 vCPU/512 MB may OOM first) | latency | Run §2.3 protocol before flipping any flag |
| R2 | blocker | `telemetryHash` never reaches chain; on-chain hash commits LLM-tainted JSON | deploy | Plumb hash through schemas/normalize/form-agent |
| R3 | blocker | External `vision.pose` skill collides → double receipt | external | Distinct skill |
| R4 | blocker | External receipt commits non-deterministic LLM hash | external | Widen schema for telemetryHash, or stop claiming determinism there |
| R5 | blocker | On-disk "phone clip" is a Meet recording (no tennis) | hardval | Capture real footage first |
| R6 | high | Nested retry = up to 6×120 s analyze per failing job | latency | `DENSE=0` default on Koyeb; env-configurable timeout |
| R7 | high | Cross-arch hash divergence (arm64 dev vs amd64 prod) | deploy | Pin amd64 image+digest; two-run in-image check; never reuse dev hash |
| R8 | high | External branch uses v1 schema → rejects v2.1 | external | Port v2 schema/normalizer first |
| R9 | high | Adapter null-in-`metrics` throws | external | Omit/relocate null fields |
| R10 | high | Racket fusion could perturb body keypoint bytes | fusion | Separate decode + separate smoothing + NEW racket-on regression |
| R11 | high | "works on phone" over-claim from a tiny relative gate | hardval | Hard-cap to relative localization |
| R12 | med | `config.ts` dist-path env bug breaks prod boot | merge | Smoke-test `node dist/index.js` |
| R13 | med | Multi-thread relax is code, not config; torch overrides OMP | latency | Env-gate the 3 pins; verify applied |
| R14 | med | `.gitignore` `+docs/` drops future docs | merge | Drop/scope; verify `git check-ignore` |
| R15 | med | Racket payoff computed but never rendered / contact-frame dropped | fusion | Render in `prompts.ts`; populate summary angles |
| R16 | med | Racket fail-open emits unprovenanced angles into hashed payload | fusion | FAIL CLOSED; prebake `best.pt` |
| R17 | med | External local-CID → null videoUrl → engine 400 (no fallback) | external | Add fallback or document IPFS-only |
| R18 | med | Cold start may exceed 120 s; watcher misses event while asleep | deploy | Keep-warm/pre-trigger; set `START_BLOCK` |
| R19 | low | Racket head unwired — phone racket eval validates a non-shipped model | hardval/fusion | Sequence after body |
| R20 | low | velo19 index reversed in note vs builder | fusion | Follow builder; assert names[17]=butt,[18]=tip |
| R21 | low | Merged `prompts.ts` prose garble tsc won't catch | merge | Human read |

**Corrected non-risks:** ultralytics version mismatch (both 8.3.40); render.yaml "mediapipe deploy bug" (YOLO ENV always wins).

---

## 4. DECISIONS FOR HUMAN

- **D1. Merge approach** → **2-parent merge into a fresh branch off current `origin/main`** (clean; rebase/cherry-pick rewrite history for no benefit).
- **D2. Deploy target** → Koyeb, but **defer eco-vs-paid to the R1 bench; assume paid/always-on is likely required** (0.1 vCPU/512 MB may OOM; 6× retry saturates scale-to-zero).
- **D3. External vs v2-form-agent path** → **v2 form-agent for production** (zero adapter, preserves honesty + telemetryHash); external = plumbing smoke test only, after the v2 schema port. *(This is the "perfect fit" answer to the upstream/downstream question.)*
- **D4. Racket now vs later** → **DEFER, ship OFF by default.** (Contradicts the stated racket-first choice — re-decide.)
- **D5. yolo11s vs yolo11l canonical image** → **11s for the canonical image**; revisit 11l only if R1 shows coarse-11s well under budget + memory headroom. (Swapping weights changes `weights_sha256` → changes `telemetryHash` → re-pin + regenerate reference hash.)
- **D6. Where to commit `telemetryHash` on-chain** → **(a) embed in `receipt.summary` for the demo** (no contract change), **(b) dedicated `bytes32` field long-term** (needs migration). (a) lands the hash in the EIP-712 signature now, but as a substring in LLM-tainted text — honest only if described as such.
- **D7. Relax single-thread on Koyeb** → benchmark both; relax only if `test_determinism.py` stays byte-identical N=1 vs N=8 inside the Koyeb image. Code change to `determinism.py`; touches the determinism boundary.

---

## 5. End-to-end verification ladder

The e2e flow is a chain, so it's verified as a **gate ladder** — each rung is a concrete pass/fail; a lower rung must be green before the next. Harness: `scripts/verify_e2e.sh` (+ `scripts/verify_g1_engine_contract.py`, `lib/velo-agents/verify_g2_seam.ts`). It runs every gate that's physically runnable today and **reports the blocked ones honestly — it never fakes a gate.**

**The flow:** `video (IPFS CID) → engine /analyze → TennisTelemetry + telemetryHash → form-agent → normalize+Zod → Groq FormReport → bytes32 receipt → EIP-712 sign → submitFormReceipt (Somnia) → readable receipt → hash reproducible`

| Gate | Proves | Tool | Status (2026-06-07, arm64 M2) |
|---|---|---|---|
| **G0 Determinism** | the hash is stable | `test_determinism.py` (3 fresh procs, OMP 1 vs 8) | ✅ **PASS** — byte-identical `sha256:c1b7209c…` |
| **G1 Engine contract** | engine emits valid v2 output | in-process `TestClient` POST `/analyze` on a real clip | ✅ **PASS** — schemaVersion 2.1, real telemetryHash, 4 strokes, racketKeypoints=false, isMock=false |
| **G2 Agent seam** | agent eats v2 telemetry | `normalizeTelemetry()` + Zod (no keys, no chain) | ✅ **PASS** — validates; honesty signals (velocityScaleSource/timingGranularityMs/normalizedCfr/peakProximalToDistalGain) flow; **and confirms R2: telemetryHash is DROPPED at `normalize-telemetry.ts:21-31`** |
| **G2.7 EIP-712 (offline)** | the agent's signing is self-consistent | ephemeral wallet sign → `verifyTypedData` recover | ✅ **PASS** — signer recovers (`verify_chain.ts`) |
| **G3-read Live chain** | the agent's sigs are accepted by the LIVE contract | read-only Somnia RPC: chainId, bytecode, `minJobFee()`, **on-chain `domainSeparator()` == agent's domain** | ✅ **PASS** — domain **MATCH** on `0x2A0B…df49` (chainId 50312, bytecode present, minJobFee 0.001 STT) |
| **G3-write On-chain submit** | a real receipt lands + reads back | funded key → `submitFormReceipt` → `getFormReceipt` | 🚫 **BLOCKED** — needs funded `AGENT_FORM_PRIVATE_KEY` + registered agent + live `JobRequested` + LLM key; **writes to Craig's live contract** |
| **G4 Determinism audit** | the on-chain claim is *real* | re-run engine on same clip in **canonical amd64 image**, recompute → must match on-chain bytes32 | 🚫 **BLOCKED** — needs G3-write + the pinned image (dev box is arm64; cross-arch `round_keypoints` unmeasured) |
| **G5 Latency/SLA** | survives Koyeb under the 120s abort (×6 retry) | Koyeb bench, cold+warm, memory | 🚫 **BLOCKED** — needs deploy. Local proxy: M2 single-thread coarse ≈ 10.4 s/10 s clip |
| **G6 Racket regression** | racket doesn't corrupt body bytes | racket-on body sub-tree == body-only hash | 🚫 **BLOCKED** — racket not fused |

**Negative tests (honesty):** mock path (`is_mock`) must NOT emit a deterministic-looking bytes32; null `videoUrl` handled; degraded engine returns 503 not a lie.

**Two principles:** (1) verify locally first (engine container + runner against testnet) before touching Craig's live deploy; (2) **G4 is the linchpin** — "reproducible on-chain proof" is only true once an outsider can re-run the canonical image and reproduce the hash. That's what R2 + the bytes32 migration unlock. Until then, G0–G2 green proves the engine + seam are sound; G3–G6 stay honestly red.
