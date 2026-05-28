# velo-agents

Autonomous agent runner for Velo — watches Somnia for `JobRequested` events and autonomously runs the two-agent pipeline: Form Analyst → Prescriber.

## What it does

```
Somnia: JobRequested event
  → FormAgent fetches video from IPFS, calls velo-engine for MediaPipe telemetry
  → Groq llama-3.3-70b analyses pose data → FormReport JSON
  → Pins to Pinata → EIP-712 signs → submitFormReceipt() on Somnia

Somnia: FormReceiptSubmitted event
  → PrescriberAgent reads form receipt ON-CHAIN (proves chain read)
  → Computes priorReceiptHash = ReceiptLib.digest(formReceipt)
  → Groq generates Prescription → Pins → signs → submitPrescription()
  → Escrow splits 40/60, AthleteSBT.appendReceipt() → NFT updated
```

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
