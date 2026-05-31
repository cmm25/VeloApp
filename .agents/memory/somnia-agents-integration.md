---
name: Somnia native agents (IAgentRequester) integration gotchas
description: Non-obvious ABI/economics facts for invoking Somnia Agents from an off-chain EOA; why the native path silently falls back
---

# Somnia Agents (Agentic L1) — invoking from an off-chain EOA

Velo's agent runner drives Somnia's native agents synchronously (no contract callback):
createRequest → recover requestId → poll getRequest until consensus → decode bytes result.
Code: `lib/velo-agents/src/ai/somnia-agents.ts`.

## Gotchas that cause a SILENT fall back to Groq
The dispatch layer catches `SomniaAgentsUnavailable` and falls back, so any of these
make the native path look "configured" but never actually run:

- **createRequest has TWO forms.** The *basic* one is 4 args only:
  `createRequest(uint256 agentId, address callback, bytes4 selector, bytes payload)`.
  `subcommitteeSize`/`threshold`/`consensusType`/`timeout` belong to
  `createAdvancedRequest` (8 args). Extra args → different selector → revert.
- **LLM agent method is `inferString(prompt, system, chainOfThought, allowedValues)`**
  returning `string` — NOT `inferChat(system,user)`. (`inferChat` exists but takes
  `(string[] roles, string[] messages, bool)`.) Prompt is first, system second.
- **`RequestCreated` event** = `(uint256 indexed requestId, uint256 indexed agentId,
  uint256 perAgentBudget, bytes payload, address[] subcommittee)` — indexed *agentId*,
  not requester. Wrong signature → topic0 mismatch → requestId log recovery fails.
- **Per-agent price floor (economics, not ABI).** Runners skip a request whose
  `perAgentBudget` is below their fixed per-type price. Today: JSON API 0.03, **LLM
  Inference 0.07**, LLM Parse Website 0.10 (STT/SOMI). Deposit =
  `getRequestDeposit()` (operations reserve = minPerAgentDeposit×subSize) + price×subSize.
  `perAgentBudget = (msg.value − reserve) / subSize`. Underfunding → on-chain TimedOut.
- **Basic createRequest uses the platform DEFAULT subcommittee size (3).** Size the
  reward against 3 (a constant), not a configurable env, or a misconfig underfunds.
- **Receipt viewer URL** is `<base>/receipts/<requestId>` (testnet base
  `https://agents.testnet.somnia.network`), not `/request/<id>`.

**Why:** all verified against docs.somnia.network/agents (invoking-agents/from-solidity,
/quickstart, /gas-fees, /receipts; base-agents/llm-inference) — the on-chain web app
auto-generates the authoritative Solidity/TS snippets per agent.

**Verified-correct config:** testnet platform `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`,
chainId 50312, currency STT. Mainnet platform `0x5E5205CF39E766118C01636bED000A54D93163E6`,
chainId 5031. The general testnet RPC `https://dream-rpc.somnia.network` and the
agents-specific `https://api.infra.testnet.somnia.network` both serve chain 50312.

## The EOA read-back race (biggest silent-fallback cause)
The platform **deletes the Request struct from storage on consensus** (gas reclaim), so
after finalization `getRequest(id)` reverts custom error `RequestNotFound(uint256)`
(selector `0x4ec726c7`, arg = the requestId). The consensus *result bytes* are delivered
ONLY to the requester's on-chain `handleResponse` callback; `RequestFinalized(id,status)`
carries status, not the result. An off-chain EOA has no callback, so polling for overall
`status==Success` essentially never wins — by the time we poll, it's deleted → always Groq.
**Fix (Tier 1, code-only):** poll briskly (≤1s) and accept the FIRST individual validator
response in `responses[]` with per-response `status==Success` + decodable `result`, even
while the overall request is still `Pending` — Qwen3 is deterministic (seed 0) so one
response == consensus. Use `hasRequest(uint256)` to tell "still pending / transient RPC"
(keep polling) apart from "finalized & removed" (terminal → clean fallback).
**Fix (Tier 2, race-free):** a relay contract that IS the callback, stores the result, and
emits it; the runner reads that. Needed only if Tier 1's window proves too tight live.
**Why:** verified against docs `invoking-agents/from-solidity` (interface ships BOTH
`getRequest` and `hasRequest` — the tell that requests stop existing) + selector brute-force.

## How to apply
Cannot test end-to-end without a funded wallet + real `SOMNIA_LLM_AGENT_ID` on live
testnet. To verify the native path actually ran (not fell back), check provenance:
`provenance.path === "native"` with a `somnia.requestId`, and that the receipt URL resolves.
The runner logs `Somnia agent result captured ✓` on success; the clean terminal fallback
message names whether the request was readable-but-empty vs. finalized-and-removed.
