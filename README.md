# Velo

Autonomous AI tennis coaching on the [Somnia](https://somnia.network) blockchain.

A coach posts a match tape, and two autonomous agents — a **Form Analyst** and a
**Prescriber** — analyze the footage, reason about technique, and write signed
coaching receipts on-chain. Athletes own their tape library and a soulbound
identity; every analysis is verifiable.

## Architecture

| Component | Path | Stack | Port |
|-----------|------|-------|------|
| Frontend | `Velo/` | React + Vite, wouter, wagmi/viem | 5173 (dev) |
| Agent runner + API | `lib/velo-agents/` | TypeScript, Express, ethers, jose | 3001 |
| Vision engine | `lib/velo-engine/` | Python, FastAPI, MediaPipe | 8000 |
| Smart contracts | `Hardhat/` | Solidity, Hardhat (chainId 50312) | — |

The frontend dev server proxies `/api/*` to the agent runner on port 3001. The
runner exposes the auth, upload, receipt, **tape**, and **athlete** surfaces the
app calls, talks to the vision engine for telemetry, runs the agents, and writes
receipts to Somnia. Off-chain data is mirrored in Supabase when configured;
otherwise everything runs in-memory (fine for local demos).

## Prerequisites

- Node.js 20+
- Python 3.10+
- A wallet funded with Somnia testnet STT (for on-chain runs)

## Running locally

Run each component in its own terminal from the repo root.

### 1. Vision engine (`lib/velo-engine`)

```bash
cd lib/velo-engine
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

### 2. Agent runner + API (`lib/velo-agents`)

```bash
cd lib/velo-agents
cp .env.example .env        # then fill in the values below
npm install
npm run dev                 # serves the API on :3001 and runs the agents
```

Minimum `.env` for a local demo:

```
API_SECRET=any-dev-secret
VISION_MODE=mock            # skip MediaPipe; return canned telemetry
```

For a full on-chain run also set: `ORCHESTRATOR_ADDRESS`,
`AGENT_FORM_PRIVATE_KEY`, `AGENT_PRESCRIBER_PRIVATE_KEY`, and one AI key
(`GROQ_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`). Optional:
`PINATA_JWT` (real IPFS uploads — omit for client-side demo CIDs),
`SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (persistent off-chain storage).

### 3. Frontend (`Velo`)

```bash
cd Velo
npm install
npm run dev                 # http://localhost:5173
```

## API surface (`lib/velo-agents`)

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET | `/api/healthz` | — | Liveness |
| GET | `/api/auth/nonce` | — | SIWE nonce + message |
| POST | `/api/auth/verify` | — | Exchange signature for a session token |
| POST | `/api/pinata/sign-upload` | session | Presigned IPFS upload (or demo mode) |
| GET | `/api/receipts/:jobId` | — | Indexed form + prescription receipts |
| GET | `/api/tapes/:address` | — | An athlete's tape library |
| POST | `/api/tapes` | session | Add a tape (owned by the session wallet) |
| DELETE | `/api/tapes/:id` | session | Remove a tape (owner only) |
| GET | `/api/athletes` | — | Shared display-name directory |
| PUT | `/api/athletes/:address` | session | Set a name (session must match address) |
| POST | `/api/athletes/verify-claim` | — | Verify a signed name claim |

Sessions are minted via SIWE: the wallet signs the nonce message, the runner
returns a short-lived JWT, and authenticated routes require it as a
`Bearer` token. Tape and athlete writes are scoped to the signing wallet, so a
user can only modify their own data.

## Off-chain storage

`docs/supabase-schema.sql` defines the optional Supabase schema. Reads
(receipts, jobs, athletes, tapes) are public; telemetry, agent runs, and upload
sessions are service-only. All writes go through the authenticated API routes —
the anon key never writes. Without Supabase configured the runner keeps the same
data in memory.

## Smart contracts (`Hardhat`)

Deployed to Somnia testnet (chainId **50312**). See `Hardhat/` for sources,
deploy scripts, and the orchestrator / agent registry / athlete SBT addresses
that the runner and frontend consume via environment variables.
