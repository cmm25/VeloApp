# Deploying Velo

The frontend is already on Vercel and the contracts are already on Somnia testnet. To make the full app work end-to-end you deploy **one thing** — the agent runner (`lib/velo-agents`) — and point the frontend at it. The Python vision engine and Supabase are optional add-ons that improve accuracy and persistence but are not required to get the on-chain flow working.

---

## Do I need Supabase?

No, but you probably want it.

Without it the runner keeps off-chain data (receipts, tapes, roster links, athlete display names) in process memory. Everything works, but that data is lost whenever the service restarts or wakes from sleep — and free hosting tiers sleep when idle.

With it, the same data is stored in a Postgres database and survives restarts indefinitely. Any new runner instance that connects to the same Supabase project picks up exactly where the last one left off.

To enable Supabase: open your project's SQL editor, paste the entire contents of `docs/supabase-schema.sql`, and run it. Then add two environment variables to the runner only (never to the frontend):

- `SUPABASE_URL` — your project URL (looks like `https://xxxx.supabase.co`)
- `SUPABASE_SERVICE_KEY` — the `service_role` secret key from your project settings

The service key bypasses Supabase's row-level security so it must stay on the server. The Vercel frontend never communicates with Supabase directly.

---

## Do I need the vision engine?

No. Set `VISION_MODE=mock` on the agent runner and it generates plausible synthetic pose telemetry instead of calling the engine. The AI agents still reason over that data and produce real coaching reports, so the full on-chain job flow works without ever deploying the Python service.

Deploy the engine (`lib/velo-engine`) when you want real MediaPipe pose analysis from actual video footage, or when you are ready to plug in your own custom model.

---

## Step 1 — Deploy the agent runner

The runner ships a `Dockerfile` and reads the platform-injected `PORT` variable automatically. The health check path is `/api/healthz`.

### Option A — Render

1. New → **Web Service** → connect this repository.
2. Root directory: `lib/velo-agents`. Render will detect the Dockerfile automatically.
3. Instance type: **Free**. Health check path: `/api/healthz`.
4. Add the environment variables listed below and deploy.

### Option B — Koyeb

1. Create → **Web Service** → from this repository (Docker source).
2. Dockerfile path: `lib/velo-agents/Dockerfile`. Docker context: `lib/velo-agents`.
3. Instance: **Free / eco**. Health check path: `/api/healthz`.
4. Add the environment variables and deploy.

### One-click Render (render.yaml)

The `render.yaml` at the root of this repository defines both the agent runner and the vision engine as Render services. Import it from the Render dashboard to create both services at once. You will still need to fill in the secret environment variables manually — they are marked `sync: false` in the file so they are never committed to the repository.

### Required environment variables

| Variable | What to put |
|----------|-------------|
| `API_SECRET` | Any strong random string (32+ characters) |
| `ORCHESTRATOR_ADDRESS` | From `Hardhat/deployments/somniaTestnet.json` |
| `AGENT_REGISTRY_ADDRESS` | From `Hardhat/deployments/somniaTestnet.json` |
| `ATHLETE_SBT_ADDRESS` | From `Hardhat/deployments/somniaTestnet.json` |
| `BOUNTY_EXTENSION_ADDRESS` | From `Hardhat/deployments/somniaTestnet.json` |
| `AGENT_FORM_PRIVATE_KEY` | Funded Somnia EOA (the Form Agent wallet) |
| `AGENT_PRESCRIBER_PRIVATE_KEY` | Funded Somnia EOA (the Prescriber wallet) |
| `GROQ_API_KEY` | From console.groq.com — or use `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` instead |
| `VISION_MODE` | Set to `mock` if you are not deploying the vision engine |

Optional but recommended: `PINATA_JWT` for real IPFS uploads (the runner uses demo CIDs without it), `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (see above), and the `SOMNIA_AGENTS_*` variables for the native on-chain AI path. The full list with descriptions is in `lib/velo-agents/.env.example`.

---

## Step 2 — Point the frontend at the runner

The Vercel frontend calls a relative `/api` path, which Vercel rewrites to your runner's URL. Open `Velo/vercel.json` and replace `YOUR-RUNNER-URL` with the public URL from Step 1:

The URL looks like `https://velo-agents.onrender.com` (Render) or `https://velo-agents-xxxx.koyeb.app` (Koyeb).

Commit the change and redeploy on Vercel. The frontend now routes all API calls to your runner.

---

## Step 3 — Enable Supabase (optional)

Follow the instructions in the "Do I need Supabase?" section above: run the SQL schema, then add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to the runner's environment variables and redeploy.

---

## Step 4 — Deploy the vision engine (optional)

For real MediaPipe pose analysis — or to run your own custom model — deploy `lib/velo-engine`. It also ships a `Dockerfile` and honors the platform-injected `PORT`.

After it is running, add two variables to the **agent runner** (not the engine):
- `VISION_ENGINE_URL` — the engine's public URL
- `VISION_MODE=live`

Then redeploy the runner. It will now call the engine for every new job.

### Custom model instead of MediaPipe

The vision engine supports pluggable analysis backends. To use your own trained model instead of MediaPipe:

1. Place your weights file inside `lib/velo-engine/custom_models/`.
2. Set `ANALYZER_BACKEND=custom` and `CUSTOM_MODEL_PATH=custom_models/your_file` on the engine service.
3. Implement the analysis logic in `lib/velo-engine/src/analyzer_custom.py` (the file contains a detailed guide).
4. Rebuild and redeploy the engine.

The agent runner does not need to change — it sends the same `/analyze` request and receives the same `TennisTelemetry` response regardless of which backend the engine uses.

---

## Free-tier caveats

**Sleeping** — free instances spin down when idle. The first request after a sleep restarts the process, which is slow. The on-chain event watcher resumes near the chain head on restart, so events emitted while the service was down can be missed. For demos this is acceptable; for production set a `START_BLOCK` that covers any gap or use a paid tier.

**In-memory data** — without Supabase, a restart wipes all off-chain data (receipts, tapes, roster). Enable Supabase to make restarts transparent.

**Agent wallets** — keep both agent EOAs funded with STT. If they run dry, receipt submissions fail and the on-chain escrow stays locked until the job deadline expires.
