# velo-agents

The autonomous agent runner for Velo. A single process that watches Somnia for
`JobRequested` events, runs the two-agent pipeline (Form Analyst → Prescriber),
and serves the `/api` the frontend calls.

## Pipeline

```
JobRequested → Form Analyst: fetch video, get telemetry from velo-engine,
               reason over pose data → sign EIP-712 receipt → submitFormReceipt()
FormReceiptSubmitted → Prescriber: read the form receipt on-chain →
               generate a prescription → sign → submitPrescription()
               → escrow splits the fee, AthleteSBT is updated
```

AI verdicts are produced by Somnia's native LLM Inference agent when
`SOMNIA_AGENTS_ENABLED=true` and `SOMNIA_LLM_AGENT_ID` is set, and fall back to
Groq automatically on timeout or unavailability. The UI badges which path was
used.

## Setup

```bash
cp .env.example .env   # fill in the values
npm install
```

## Run

```bash
npm run dev               # needs the vision engine running (see lib/velo-engine)
VISION_MODE=mock npm run dev   # skip the engine, use synthetic telemetry
```

## Key environment variables

| Variable | Purpose |
|----------|---------|
| `API_SECRET` | Signs upload session tokens (required) |
| `ORCHESTRATOR_ADDRESS` | From `Hardhat/deployments/somniaTestnet.json` |
| `AGENT_FORM_PRIVATE_KEY` | Funded EOA for the Form agent |
| `AGENT_PRESCRIBER_PRIVATE_KEY` | Funded EOA for the Prescriber |
| `GROQ_API_KEY` | AI key (or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) |
| `VISION_MODE` | `mock` to skip the engine; `live` to use it |
| `PINATA_JWT` | Optional — real IPFS uploads (demo CIDs without it) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Optional — persistent off-chain storage |

See `.env.example` for the complete list, including the `SOMNIA_AGENTS_*` native
agent settings.

## API

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/healthz` | — | Liveness + chain status |
| GET | `/api/auth/nonce` | — | SIWE nonce + message |
| POST | `/api/auth/verify` | — | Exchange signature for a session token |
| POST | `/api/pinata/sign-upload` | session | Presigned IPFS upload (or demo mode) |
| GET | `/api/receipts/:jobId` | — | Indexed form + prescription receipts |
| GET | `/api/tapes/:address` | — | An athlete's tape library |
| POST/DELETE | `/api/tapes` · `/api/tapes/:id` | session | Add / remove own tapes |
| GET | `/api/athletes` | — | Shared display-name directory |
| PUT | `/api/athletes/:address` | session | Set own display name |
| GET/POST/DELETE | `/api/roster` | session | Coach ↔ athlete links |

Sessions are minted via SIWE and writes are scoped to the signing wallet, so a
user can only modify their own data.

## Deploy

See [`../../docs/DEPLOY.md`](../../docs/DEPLOY.md).
