# Velo On-Chain Determinism-Hash — Decision: **NO contract change**

> 2026-06-07. Supersedes the earlier D6 "dedicated bytes32 field" pick. The deployed
> contracts are NOT touched. The deterministic `telemetryHash` is committed on-chain via
> the **existing** `summaryHash` + IPFS path. The full bytes32-contract spec is preserved
> at the end as the rejected alternative (in case direct on-chain readability is ever needed).

## The chosen fix (agent-side only, ~2 lines, no contract change) — DONE

The form receipt **already** pins `reportPayload` (which contains `telemetry`) to IPFS and
sets `summaryHash = keccak256(reportPayload)` ([form-agent.ts:77-95](../lib/velo-agents/src/agents/form-agent.ts#L77-L95)).
The on-chain receipt already commits both `ipfsCid` and `summaryHash`. The **only** gap (R2)
was that `normalizeTelemetry` stripped `telemetryHash` ([normalize-telemetry.ts:21-31](../lib/velo-agents/src/ai/normalize-telemetry.ts#L21-L31))
before it reached `reportPayload`.

**Fix applied (feature branch, reversible):**
1. `schemas.ts` — added `telemetryHash: z.string().nullish()` to `TennisTelemetrySchema`.
2. `normalize-telemetry.ts` — carry `telemetryHash: camel.telemetryHash` in the `flat` object.

Verified: `verify_g2_seam.ts` now asserts **R2 FIXED — telemetryHash survives normalize** (was dropped). It rides into the pinned report; the on-chain `summaryHash` commits it.

**Verification (G4 audit):** an auditor fetches the IPFS doc via the receipt's `ipfsCid`,
reads `telemetryHash`, re-runs the engine on the same clip in the canonical amd64 image,
and confirms a byte-match. The on-chain `summaryHash` proves the IPFS doc wasn't tampered.
Cryptographically equivalent to a dedicated field for the determinism guarantee.

## Why the dedicated `bytes32` field was REJECTED

The 7-agent migration workflow (`wsecy282j`) found it heavy and risky:
- **TWO-contract redeploy** — `VeloOrchestrator` + `BountyExtension` both verify against the
  shared `ReceiptLib` type-hash, so both addresses change.
- **Immutable contracts** (no proxy/initializer) → a new deploy = **new addresses** → breaks
  the live runner `.env` + the frontend wiring → a **Craig-coordinated** migration.
- The receipt type-hash lives in **4 hand-maintained copies** (`ReceiptLib.sol`, agent
  `eip712.ts`, frontend `eip712.ts`, raw ABI tuples) — any positional drift silently breaks
  **every** signature (`AgentMismatch` revert).
- Only benefit: `telemetryHash` readable directly on-chain without fetching IPFS. Not worth a redeploy.

**If ever needed later:** append `bytes32 telemetryHash` to `ReceiptLib.Receipt` (index 8,
after `priorReceiptHash`), update the `RECEIPT_TYPEHASH` string + `structHash()`, mirror all
4 off-chain copies byte-for-byte, leave `digest()`/`validate()`/events/SBT untouched, and do
it as a planned Craig-led Orchestrator+Bounty redeploy. Defer until there's a concrete need.
