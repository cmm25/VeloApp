# Deploying Velo

The frontend is already on Vercel and the contracts are already on Somnia
testnet. To make the full app work you deploy **one thing** — the agent runner
(`lib/velo-agents`) — and point the frontend at it. The Python vision engine and
Supabase are optional add-ons.

## Do I need Supabase?

No — it's optional.

- **Without it:** the runner keeps off-chain data (receipts, tapes, roster,
  athlete display names) in memory. Everything works, but that data is **lost
  whenever the runner restarts or sleeps** — and free tiers sleep when idle.
- **With it:** the same data persists across restarts. Recommended for any
  deployment people actually use.

To enable it: open your Supabase project's **SQL editor**, paste the contents of
[`supabase-schema.sql`](./supabase-schema.sql), and run it. Then set two secrets
**on the runner only** (never in the frontend):

- `SUPABASE_URL` — your project URL
- `SUPABASE_SERVICE_KEY` — the `service_role` key

The service key bypasses Supabase's row-level security, so it must stay
server-side. The Vercel frontend never talks to Supabase directly.

## Step 1 — Deploy the agent runner

The runner ships with a Dockerfile and reads the host's `PORT` automatically.
Health check path: `/api/healthz`.

### Option A — Render (free)

1. New → **Web Service** → connect this repo.
2. Root directory: `lib/velo-agents`. Render detects the Dockerfile.
3. Instance type: **Free**. Health check path: `/api/healthz`.
4. Add the environment variables (see below) and create the service.

### Option B — Koyeb (free)

1. Create → **Web Service** → from this repo (Docker).
2. Dockerfile location: `lib/velo-agents/Dockerfile`.
3. Instance: **Free / eco**. Health check path: `/api/healthz`.
4. Add the environment variables (see below) and deploy.

Either way, copy the public URL it gives you (e.g.
`https://velo-agents.onrender.com`).

### Required env vars (real on-chain deploy)

| Variable | Notes |
|----------|-------|
| `API_SECRET` | Any strong random string |
| `ORCHESTRATOR_ADDRESS` | From `Hardhat/deployments/somniaTestnet.json` |
| `AGENT_FORM_PRIVATE_KEY` | Funded Somnia EOA |
| `AGENT_PRESCRIBER_PRIVATE_KEY` | Funded Somnia EOA |
| `GROQ_API_KEY` | Or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| `VISION_MODE` | `mock` if you don't deploy the engine (Step 4) |

Optional: `PINATA_JWT` (real IPFS uploads — demo CIDs without it),
`SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (Step 3), and the `SOMNIA_AGENTS_*` vars
for the native on-chain AI path. See `lib/velo-agents/.env.example` for the full
list.

## Step 2 — Point the frontend at the runner

The frontend calls a relative `/api`. In `Velo/vercel.json`, replace the
`YOUR-RUNNER-URL` placeholder with the URL from Step 1:

```json
{ "source": "/api/(.*)", "destination": "https://velo-agents.onrender.com/api/$1" }
```

Commit and redeploy on Vercel. The frontend now reaches your runner.

## Step 3 — Enable Supabase (optional)

Follow the "Do I need Supabase?" section above: run the SQL file, then add
`SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to the runner's env vars and redeploy
the runner.

## Step 4 — Deploy the vision engine (optional)

For real MediaPipe analysis instead of mock telemetry, deploy
`lib/velo-engine` (it also ships a Dockerfile and honors `PORT`). Then on the
runner set `VISION_ENGINE_URL` to the engine's URL and `VISION_MODE=live`.

## Free-tier caveats

- Free instances **sleep when idle**, which pauses the on-chain watcher (the
  first request after idle is slow). On a simple resume the watcher continues
  from where it left off; after a full restart it resumes near the chain head, so
  events emitted while it was down can be missed unless you set `START_BLOCK`.
- Without Supabase, a restart wipes in-memory off-chain data.
- Keep the two agent wallets funded with STT so receipts can be submitted.
