# velo-agents

The autonomous agent runner for Velo. It is a single Node.js process that does three things at once: it watches the Somnia blockchain for new jobs and bounties, it runs the AI pipeline that produces coaching reports, and it serves the REST API that the React frontend calls.

---

## The job pipeline

When a coach pays for an athlete's video to be analysed, an event is emitted on-chain. The runner picks it up and runs two agents in sequence.

**Form Agent** — fetches the video, sends it to the vision engine (or generates mock telemetry), and then asks an LLM to reason over the pose data and write a structured coaching form: what stroke, what phase, what angles are off, what the athlete needs to work on. It signs this report with an EIP-712 cryptographic receipt and submits it back on-chain.

**Prescriber Agent** — reads the completed form receipt on-chain, then asks an LLM to write a full training prescription: specific drills, target rep counts, a weekly schedule. It signs and submits that report too. At this point the on-chain escrow releases, the agents are paid in STT, and the athlete's Soulbound Token is updated with a permanent record of the session.

**Bounty Agent** — same idea but triggered by the open bounty marketplace. When a bounty is accepted on-chain, this agent processes the submitted video and settles the bounty.

---

## AI paths

The runner supports two paths for producing AI verdicts, and switches between them automatically.

**Somnia native path** — when `SOMNIA_AGENTS_ENABLED=true` and a valid `SOMNIA_LLM_AGENT_ID` is set, each LLM call is submitted to Somnia's on-chain LLM Inference platform. Multiple runners reach consensus on the answer, and the result comes back with a cryptographic on-chain receipt that the UI can link to directly. This is the preferred path for production because the AI reasoning itself becomes verifiable.

**Groq fallback** — if the native path times out, returns no runners, or is not configured, the runner falls back to Groq (or OpenAI / Anthropic if those keys are set instead). The UI shows which path was used on each receipt.

---

## Off-chain storage

The runner stores receipts, athlete display names, video tape metadata, and coach-athlete roster links. By default this all lives in memory and is lost when the process restarts. Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to persist everything in Supabase instead.

Every store operation tries Supabase first. If Supabase is not configured or a write fails, it silently falls back to the in-memory store so the process never crashes over a database issue. This means the runner is fully functional without Supabase — it just loses off-chain data across restarts.

See `docs/supabase-schema.sql` for the exact table definitions to apply to your Supabase project.

---

## REST API

The frontend talks to this service via a proxied `/api` path.

| Method | Route | Who can call | What it does |
|--------|-------|-------------|--------------|
| GET | `/api/healthz` | anyone | Liveness check. Returns chain connection status |
| GET | `/api/auth/nonce` | anyone | Returns a Sign-In With Ethereum nonce and message to sign |
| POST | `/api/auth/verify` | anyone | Exchanges a signed SIWE message for a session JWT |
| POST | `/api/pinata/sign-upload` | session | Generates a presigned upload token for IPFS via Pinata (demo CID if no key) |
| GET | `/api/receipts/:jobId` | anyone | Returns the indexed form + prescription receipts for a job |
| GET | `/api/tapes/:address` | anyone | Lists an athlete's video tape library |
| POST | `/api/tapes` | session (own wallet) | Adds a new tape to the library |
| DELETE | `/api/tapes/:id` | session (owner only) | Removes a tape |
| GET | `/api/athletes` | anyone | Lists all athletes with display names |
| PUT | `/api/athletes/:address` | session (own wallet) | Sets your display name |
| GET | `/api/roster` | session | Returns a coach's active roster |
| POST | `/api/roster` | session | Sends a roster invite to an athlete |
| DELETE | `/api/roster/:athleteAddress` | session | Cancels a pending invite or removes an athlete |
| GET | `/api/me/roster-requests` | session | Returns pending coach invites addressed to the signed-in wallet |
| POST | `/api/me/roster-requests/:id/accept` | session | Accepts an invite |
| POST | `/api/me/roster-requests/:id/decline` | session | Declines an invite |
| GET | `/api/bounties/:bountyId` | anyone | Returns the indexed bounty report |

Session tokens are minted by SIWE. Write operations are scoped to the signing wallet — a wallet can only modify its own tapes, display name, and roster state.

---

## Environment variables

All variables are documented in `.env.example`. The essentials are:

- **`API_SECRET`** — used to sign session JWTs. Must be a strong random string in production.
- **`ORCHESTRATOR_ADDRESS`** and related contract addresses — from `Hardhat/deployments/somniaTestnet.json` after running the deploy script.
- **`AGENT_FORM_PRIVATE_KEY`** and **`AGENT_PRESCRIBER_PRIVATE_KEY`** — the two funded EOA wallets that submit receipts on-chain.
- **`GROQ_API_KEY`** — required unless you use the native Somnia path exclusively.
- **`VISION_MODE`** — set to `mock` to skip the vision engine entirely and use synthetic telemetry. Required if you are not deploying the engine.

---

## Deploying

The service ships a `Dockerfile` and reads the platform-injected `PORT` automatically. Both Render and Koyeb free tiers work out of the box. The health check path is `/api/healthz`.

The `render.yaml` at the root of the repository defines both services (agent runner and vision engine) for one-click Render deployment. Full step-by-step instructions, including how to wire the frontend proxy and enable Supabase, are in `docs/DEPLOY.md`.
