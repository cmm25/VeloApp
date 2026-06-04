# Velo — Revised Architecture (post-SPEC-1, hybrid reasoning)

**Date:** 2026-05-31. **Branch:** `feature-nn`. **Deadline:** ~2026-06-11.
Supersedes the reasoning-layer parts of [CODEX-RESEARCH.md](CODEX-RESEARCH.md) §4 and
[CODEX-SPEC-2-nn-testdata-tier2.md](CODEX-SPEC-2-nn-testdata-tier2.md) §4. Read this before SPEC-2.

This update folds in: (a) SPEC-1 is implemented + verified in the working tree; (b) Craig's Somnia
credentials/contracts; (c) the **hybrid reasoning** decision (Somnia native primary, Gemini fallback);
(d) a hard modality constraint discovered by reading the reasoning code.

---

## 1. The constraint that shapes everything

`lib/velo-agents/src/ai/somnia-agents.ts:40` — the Somnia native LLM-inference agent is:

```solidity
function inferChat(string systemPrompt, string userPrompt) returns (string)
```

**Text in, text out. No image modality.** So keyframe *images* can never go to the Somnia native agent.
This is not a limitation to fight — it dictates a clean split that satisfies the dual-LLM safety design
AND the "use Somnia native" judge requirement at the same time:

- **Anything that must look at pixels (keyframes) → Gemini (vision).** This is the *quarantined* Q-LLM. It
  already has no tool access and untrusted input — exactly what should be off-chain and sandboxed.
- **The planner that reasons over symbols (angles, phases, validated observations) → Somnia native
  LLM-inference (text).** This is the P-LLM — the step that produces the prescription, gets an on-chain
  consensus receipt, and is the "unique Somnia usage" the judges want.

So the privilege separation maps onto the model split with zero tension.

## 2. What's already built (don't rebuild)

`lib/velo-agents/src/ai/dispatch.ts:reason()` is **already a hybrid router**:
Somnia native LLM-inference (primary, on-chain receipt) → Groq (fallback), with the *same* Zod schema
validation on both paths and an `AiProvenance{path, agentType, somnia, fallbackReason}` recorded on every
result. `somnia-agents.ts` drives the full request lifecycle (deposit sizing, createRequest, requestId
recovery, poll-for-consensus, decode). Config in `config.ts:somniaAgents` (enabled by default; needs
`SOMNIA_LLM_AGENT_ID` set in `.env` to actually fire — else it logs and uses Groq).

**Implication:** the P-LLM hybrid is ~80% done. SPEC-2 extends it, it does not invent it.

## 3. The five tiers (current truth)

```
T0  Ingest     video by IPFS CID (JobRequested event) → gateway URL → /analyze        [DONE]
T1  Vision     YOLO11s-pose + NumPy geometry → TennisTelemetry v2 (camelCase,          [DONE, SPEC-1]
               per-stroke, confidence-gated, student-not-coach, base64 contact keyframe)
T2  Reason     Q-LLM (Gemini vision over keyframe+telemetry) → deterministic           [BUILD: SPEC-2]
               checkpoint → P-LLM (Somnia native text → Gemini → Groq) → FormReport
T3  Anchor     pin report to IPFS (Pinata) → EIP-712 receipt → submit on Somnia        [DONE, agent-runner]
T4  Prescribe  prescriber-agent reads form receipt → P-LLM → PrescriptionReport → chain [partial]
```

## 4. Tier-2 reasoning — the build target (replaces SPEC-2 §4.2)

A single new orchestrator, `lib/velo-agents/src/ai/tier2/`, producing the **existing**
`FormReportSchema` / `PrescriptionReportSchema` (don't break those — Tier-2 is a higher-quality, safety-gated
*producer* of the same shapes). Wired behind `REASONING_TIER=tier2|legacy`.

```
 TennisTelemetry v2 (symbols)            keyframe(s) (pixels, untrusted)
            │                                      │
            │                            ┌─────────▼──────────┐
            │                            │  Q-LLM  (Gemini    │   quarantined:
            │                            │  vision, Flash-Lite)│   no tools, forced JSON,
            │                            │  sees keyframe +    │   output = DATA not instructions
            │                            │  telemetry          │
            │                            └─────────┬──────────┘
            │                                      │ raw observations (untrusted JSON)
            │                            ┌─────────▼──────────┐
            │                            │ DETERMINISTIC      │   code, not a model:
            │                            │ CHECKPOINT         │   • Zod schema validate
            │                            │                    │   • verb allow-list
            │                            │                    │   • numeric range checks (every angle/target)
            │                            │                    │   • system-prompt-leak regex
            │                            └─────────┬──────────┘
            │                                      │ validated, trusted observations
            └──────────────┬───────────────────────┘
                           ▼
              ┌────────────────────────────┐
              │  P-LLM  (PLANNER)           │   reason() — text only, never sees raw pixels.
              │  reason({prompt, schema})   │   Somnia native LLM-inference (primary, on-chain receipt)
              │                             │     → Gemini text (fallback)  → Groq (last resort)
              └────────────┬───────────────┘
                           ▼
              FormReport / PrescriptionReport  (Zod-valid) → IPFS → EIP-712 → Somnia
```

### Degradation ladder (robustness — important for a demo)
1. **Full path:** Gemini Q-LLM(vision) → checkpoint → Somnia P-LLM. Best + on-chain.
2. **No keyframes / Gemini down:** skip Q-LLM, feed telemetry *symbols* straight to P-LLM (Somnia native is
   text and telemetry is already symbolic). Still on-chain, just no pixel context.
3. **Somnia down:** P-LLM falls back to Gemini-text → Groq (existing `reason()` chain, extended). Off-chain,
   provenance marks `fallback`.

So even if Gemini *or* Somnia is unavailable on demo day, a valid report is still produced. This is why the
existing `reason()` fallback router is kept as the P-LLM core rather than replaced.

### Reasoning provider matrix
| Stage | Sees | Model(s) | On-chain? | Reuses |
|-------|------|----------|-----------|--------|
| Q-LLM | keyframe image + telemetry | **Gemini 2.5 Flash-Lite (vision)** only | no (quarantined) | new |
| Checkpoint | Q-LLM JSON | deterministic code | n/a | new |
| P-LLM | validated symbols only | **Somnia native (Qwen3)** → Gemini-text → Groq | **yes (primary)** | `dispatch.ts:reason()` (extend) |

## 5. Somnia wiring (from Craig — public on-chain values, safe to commit in `.env.example` as comments)

```
SOMNIA_WS_URL=wss://dream-rpc.somnia.network/ws
WATCHER_USE_WEBSOCKET=false          # testnet WS flaky → poll
SOMNIA_CHAIN_ID=50312
ORCHESTRATOR_ADDRESS=0x2A0B15157313E81035D1f58e54da2dacd6Cfdf49
AGENT_REGISTRY_ADDRESS=0x935aABC7Ed1D2a56d036831Db02aE30c28739EBB
ATHLETE_SBT_ADDRESS=0x738550ebb0E9fE77E45a123617d165e4FE52C723
SOMNIA_AGENT_RELAY_ADDRESS=0x7b26cb56f9260432D079045CfA61A569936d862a
```
Config already reads `ORCHESTRATOR_ADDRESS`, `AGENT_REGISTRY_ADDRESS`, `ATHLETE_SBT_ADDRESS`,
`SOMNIA_CHAIN_ID`, `WATCHER_USE_WEBSOCKET` ([config.ts](../../velo-agents/src/utils/config.ts)).
`SOMNIA_AGENT_RELAY_ADDRESS` is **new** — confirm whether it maps to `SOMNIA_AGENTS_CONTRACT`
(the IAgentRequester platform, currently defaulted to `0x037Bb9…`) or is a separate relay; if it's the
requester platform, set `SOMNIA_AGENTS_CONTRACT=0x7b26cb…`. **For the native P-LLM to fire you still must set
`SOMNIA_LLM_AGENT_ID`** (live id from agents.testnet.somnia.network) — without it `reason()` silently uses Groq.

Private keys (`AGENT_FORM_PRIVATE_KEY`, `AGENT_PRESCRIBER_PRIVATE_KEY`), `GROQ_API_KEY`, `GEMINI_API_KEY` (new),
`PINATA_JWT`, `SUPABASE_*` live in `.env` only — **never commit, never print.**

## 6. Open items the next session must resolve
- **MediaPipe v2 break (blocker for SPEC-2's compare harness):** `analyze.py` still emits v1 telemetry; v2 model
  rejects it. Needs a v1→v2 adapter wrapper (do NOT edit analyze.py). SPEC-2 step 0.
- **`SOMNIA_AGENT_RELAY_ADDRESS` vs `SOMNIA_AGENTS_CONTRACT`** identity — confirm with Craig.
- **Gemini client** not yet a dependency — add `@google/generative-ai` to velo-agents.
- Run SPEC-1's parity/round-trip tests green + capture student-not-coach overlay frames (evidence not yet banked).

## 7. Answer for Shri ("what's the plan for the form agent / NN?")
Tier-1 is **stock YOLO11s-pose + deterministic NumPy geometry** — the net only localizes joints; all
biomechanics (angles, phases, stroke type, counts) are plain reproducible code, not a learned predictor. It now
emits **per-stroke `TennisTelemetry` v2**: tracks people and analyzes the **student (most-active), not the coach**;
resolves **handedness** over the whole clip; gates every joint on confidence (occluded → skipped, never
fabricated); and exports a **contact keyframe** per stroke. The form agent then reasons on **numbers, never
pixels-as-geometry**: keyframes go only to a quarantined Gemini vision pass, which is range-checked by
deterministic code, and the *planning* call that writes the report runs on **Somnia's native LLM-inference**
(on-chain receipt), with Gemini/Groq as fallbacks. Net: deterministic, auditable, and the final verdict is
on-chain. MediaPipe stays as a selectable failsafe only.
