# Velo

Autonomous AI tennis coaching on the [Somnia](https://somnia.network) blockchain.

A coach posts a match tape; two autonomous agents — a **Form Analyst** and a
**Prescriber** — analyze it, reason about technique, and write signed coaching
receipts on-chain. Athletes own their tape library and a soulbound identity, and
every analysis is verifiable.

## Architecture

| Component | Path | Stack | Port |
|-----------|------|-------|------|
| Frontend | `Velo/` | React + Vite, wouter, wagmi/viem | 5173 (dev) |
| Agent runner + API | `lib/velo-agents/` | TypeScript, Express, ethers | 3001 |
| Vision engine | `lib/velo-engine/` | Python, FastAPI, MediaPipe | 8000 |
| Smart contracts | `Hardhat/` | Solidity, Hardhat (chainId 50312) | — |

The frontend calls `/api/*`, which the agent runner serves. The runner also
watches Somnia, runs the agents, and writes receipts. The vision engine and
Supabase are both optional (see below).

## Prerequisites

- Node.js 20+
- Python 3.10+ (only if you run the vision engine)
- A wallet funded with Somnia testnet STT (for on-chain runs)

## Run locally

Run each part from the repo root in its own terminal.

```bash
# 1. Agent runner + API (http://localhost:3001)
cd lib/velo-agents
cp .env.example .env        # fill in the values
npm install
VISION_MODE=mock npm run dev # mock = skip the Python engine

# 2. Frontend (http://localhost:5173)
cd Velo
npm install
npm run dev
```

Minimum `.env` for a local demo: `API_SECRET` and `VISION_MODE=mock`. For a real
on-chain run also set `ORCHESTRATOR_ADDRESS`, `AGENT_FORM_PRIVATE_KEY`,
`AGENT_PRESCRIBER_PRIVATE_KEY`, and one AI key (`GROQ_API_KEY`). See
`lib/velo-agents/.env.example` for the full list.

## Deploy

The frontend is hosted on Vercel and the contracts are on Somnia testnet. To make
the full app work in production you deploy the agent runner and point the frontend
at it. See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the step-by-step guide.

## Off-chain storage (Supabase)

Supabase is **optional**. Without it, the runner keeps off-chain data (receipts,
tapes, roster, athlete names) in memory — fine for demos, but lost when the
process restarts. For a persistent deployment, run `docs/supabase-schema.sql` in
Supabase and set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` on the runner. Details
in [docs/DEPLOY.md](docs/DEPLOY.md).

## Smart contracts

Deployed to Somnia testnet (chainId **50312**). See `Hardhat/` for sources,
deploy scripts, and the contract addresses the runner and frontend consume.
