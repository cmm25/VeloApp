# velo-agents

Autonomous agent runner for Velo — watches Somnia for `JobRequested` events and autonomously runs the two-agent pipeline: Form Analyst → Prescriber.

## What it does

```
Somnia: JobRequested event
  → FormAgent fetches video from IPFS, calls velo-engine for MediaPipe telemetry
  → Somnia NATIVE LLM Inference agent analyses pose data → consensus FormReport JSON
    (falls back to Groq llama-3.3-70b if the native network is unavailable)
  → Pins to Pinata (with provenance) → EIP-712 signs → submitFormReceipt() on Somnia

Somnia: FormReceiptSubmitted event
  → PrescriberAgent reads form receipt ON-CHAIN (proves chain read)
  → Computes priorReceiptHash = ReceiptLib.digest(formReceipt)
  → Somnia NATIVE LLM Inference agent generates consensus Prescription (Groq fallback)
  → Pins → signs → submitPrescription()
  → Escrow splits 40/60, AthleteSBT.appendReceipt() → NFT updated
```

## Somnia native Agentic L1 (verifiable AI)

Every coaching verdict is produced by Somnia's **native LLM Inference agent**,
invoked through the `SomniaAgents` platform contract (`IAgentRequester`):

```
reason()  (src/ai/dispatch.ts)
  → runLlmInference()  (src/ai/somnia-agents.ts)
      → createRequest(agentId, payload, deposit)   [on-chain, deposit-funded]
      → poll getRequest(requestId) until consensus (Success / Failed / TimedOut)
      → decode consensus result → Zod-validate
  → on timeout / unavailability / invalid result → Groq fallback (callAI)
```

- **Deposit sizing**: `getRequestDeposit() + pricePerAgent × subcommitteeSize`
  (defaults: `0.03 STT × 3`). Sending only the floor makes runners skip the request.
- **Provenance**: each step records `{ path: native | fallback, somnia: { requestId,
  agentId, txHash, consensusStatus, receiptUrl } }`. It is pinned into the IPFS
  report payload, stored in the receipt index, and surfaced in the coach UI with a
  link to the public consensus receipt (`agents.testnet.somnia.network/request/<id>`).
- **Hybrid safety**: if the native network has no runners or times out (default
  45s), the runner automatically falls back to Groq so the demo never breaks. The
  UI clearly badges native/consensus vs. fallback.
- **Config**: set `SOMNIA_LLM_AGENT_ID` from https://agents.testnet.somnia.network/
  to activate the native path. See `.env.example` for all `SOMNIA_AGENTS_*` vars
  (contract address, agent IDs, subcommittee size, per-agent price, timeout).
  Mainnet contract: `0x5E5205CF39E766118C01636bED000A54D93163E6` (chainId 5031).

### End-to-end verification (testnet)

1. Set `SOMNIA_LLM_AGENT_ID` (from the explorer), `SOMNIA_AGENTS_ENABLED=true`,
   and fund both agent EOAs with STT (deposits are paid from the agent wallet).
2. Run `npm run dev` and submit a job from the coach UI.
3. Confirm in the runner logs: `Creating Somnia agent request` →
   `Somnia agent request created { requestId }` → `Somnia agent consensus reached`,
   then `Form report generated { path: "native", somniaRequestId: ... }`.
4. Open the job in the coach UI → each AI stage shows a **Somnia Native Agent /
   Consensus** panel linking to the consensus receipt by request ID.
5. Confirm the SBT was updated (Stage 4 "Appended to SBT").
6. **Fallback test**: set `SOMNIA_AGENTS_ENABLED=false` (or unset the agent ID)
   and re-run — the UI badges the result as **Groq Fallback / Off-chain** and the
   pipeline still completes. (Also exercised automatically when the network has no
   runners and the request times out.)

## Setup

```bash
cp .env.example .env
# Fill in: ORCHESTRATOR_ADDRESS, AGENT_FORM_PRIVATE_KEY,
#          AGENT_PRESCRIBER_PRIVATE_KEY, GROQ_API_KEY

npm install
```

## Pre-flight check

```bash
npm run precheck
```

Verifies: chain connectivity, agent balances, IPFS config, vision engine.

## Run locally

```bash
# With vision engine running (see lib/velo-engine/):
npm run dev

# Without vision engine (mock telemetry):
VISION_MODE=mock npm run dev
```

## Deploy to Koyeb

1. Build the Docker image:
```bash
docker build -t velo-agents .
docker tag velo-agents your-registry/velo-agents:latest
docker push your-registry/velo-agents:latest
```

2. Set all env vars in Koyeb dashboard.
3. Deploy — expose port 3001 for the API server.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/healthz` | Health + chain status |
| GET | `/api/auth/nonce` | Issue SIWE nonce for upload session |
| POST | `/api/auth/verify` | Verify wallet signature → JWT |
| POST | `/api/pinata/sign-upload` | Issue Pinata presigned upload URL |
| GET | `/api/receipts/:jobId` | Get indexed receipts for a job |
| GET | `/api/receipts` | List all indexed job IDs |

## Environment variables

See `.env.example` for the full list with descriptions.

Key vars:
- `ORCHESTRATOR_ADDRESS` — from `deployments/somniaTestnet.json`
- `AGENT_FORM_PRIVATE_KEY` — funded EOA for Form Agent
- `AGENT_PRESCRIBER_PRIVATE_KEY` — funded EOA for Prescriber
- `GROQ_API_KEY` — Groq free tier (llama-3.3-70b-versatile)
- `PINATA_JWT` — optional; without it, local CID demo mode activates
- `VISION_MODE=mock` — skip velo-engine, use synthetic telemetry
