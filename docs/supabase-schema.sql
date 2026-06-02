-- ════════════════════════════════════════════════════════════════════════════
-- Velo — Supabase Schema
-- Bridges on-chain Somnia data with off-chain API storage
-- ════════════════════════════════════════════════════════════════════════════
-- Connect when SUPABASE_URL + SUPABASE_SERVICE_KEY are added to velo-agents .env
-- The agent runner reads/writes these tables via the store.ts module.
-- ════════════════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── receipts ─────────────────────────────────────────────────────────────────
-- One row per job. Stores both the form receipt and prescription receipt
-- so the frontend indexer can serve them without hitting the chain.
CREATE TABLE IF NOT EXISTS receipts (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id               TEXT NOT NULL UNIQUE,        -- bytes32 hex (0x...)
    orchestrator         TEXT NOT NULL,               -- VeloOrchestrator address
    chain_id             INTEGER NOT NULL DEFAULT 50312,

    -- Form Agent receipt (set after submitFormReceipt)
    form_receipt         JSONB,                       -- StoredReceipt.form shape
    -- Prescription receipt (set after submitPrescription)
    prescription_receipt JSONB,                       -- StoredReceipt.prescription shape

    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipts_job_id ON receipts (job_id);
CREATE INDEX IF NOT EXISTS idx_receipts_chain_id ON receipts (chain_id);

-- ── jobs ─────────────────────────────────────────────────────────────────────
-- Off-chain mirror of on-chain job state, enriched with video metadata.
-- Written by the web app when a coach posts a job.
CREATE TABLE IF NOT EXISTS jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id          TEXT NOT NULL UNIQUE,      -- bytes32 hex matching on-chain
    coach_address   TEXT NOT NULL,
    athlete_address TEXT NOT NULL,
    video_cid       TEXT NOT NULL,             -- IPFS CID (or local:sha256 in demo)
    video_filename  TEXT,
    video_size_bytes BIGINT,
    fee_wei         TEXT NOT NULL,             -- stored as string (bigint safe)
    deadline        TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested', 'form_submitted', 'completed', 'cancelled')),
    tx_hash         TEXT,                      -- payJob transaction hash
    block_number    BIGINT,
    chain_id        INTEGER NOT NULL DEFAULT 50312,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_job_id        ON jobs (job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_coach         ON jobs (coach_address);
CREATE INDEX IF NOT EXISTS idx_jobs_athlete       ON jobs (athlete_address);
CREATE INDEX IF NOT EXISTS idx_jobs_status        ON jobs (status);

-- ── athletes ─────────────────────────────────────────────────────────────────
-- Athlete profiles — linked to their on-chain SBT once minted.
CREATE TABLE IF NOT EXISTS athletes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address  TEXT NOT NULL UNIQUE,
    display_name    TEXT,
    sbt_token_id    TEXT,                      -- AthleteSBT tokenId (null until first job)
    receipt_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_athletes_wallet ON athletes (wallet_address);

-- ── tapes ────────────────────────────────────────────────────────────────────
-- Athlete-owned video library. Reads are public; writes go through the agent
-- runner's SIWE-authenticated /api/tapes routes (service key), so only the
-- wallet matching the address may add or remove its own tapes.
CREATE TABLE IF NOT EXISTS tapes (
    id              BIGSERIAL PRIMARY KEY,
    wallet_address  TEXT NOT NULL,
    cid             TEXT NOT NULL,             -- IPFS CID (or local:sha256 in demo)
    label           TEXT,
    size_bytes      BIGINT,
    content_type    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tapes_wallet  ON tapes (wallet_address);
CREATE INDEX IF NOT EXISTS idx_tapes_created ON tapes (created_at);

-- ── roster ───────────────────────────────────────────────────────────────────
-- Off-chain coach↔athlete links. A coach invites an athlete by wallet address,
-- creating a `pending` row; the athlete accepts (→ `active`) or declines (row
-- deleted). Reads are public (frontend reads coaches-for-athlete directly);
-- writes go through the agent runner's SIWE-authenticated /api/roster + /api/me
-- routes (service key), so only the relevant coach/athlete may mutate a row.
CREATE TABLE IF NOT EXISTS roster (
    id              BIGSERIAL PRIMARY KEY,
    coach_address   TEXT NOT NULL,
    athlete_address TEXT NOT NULL,
    label           TEXT,                       -- private coach label
    source          TEXT NOT NULL DEFAULT 'address',
    invite_id       TEXT,                       -- reserved (legacy invite link)
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at     TIMESTAMPTZ,
    UNIQUE (coach_address, athlete_address)
);

CREATE INDEX IF NOT EXISTS idx_roster_coach   ON roster (coach_address);
CREATE INDEX IF NOT EXISTS idx_roster_athlete ON roster (athlete_address);
CREATE INDEX IF NOT EXISTS idx_roster_status  ON roster (status);

-- ── telemetry ────────────────────────────────────────────────────────────────
-- Raw MediaPipe output per job (off-chain only — too large for IPFS/chain).
-- Full TennisTelemetry JSON from velo-engine.
CREATE TABLE IF NOT EXISTS telemetry (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id       TEXT NOT NULL UNIQUE REFERENCES jobs(job_id) ON DELETE CASCADE,
    data         JSONB NOT NULL,               -- Full TennisTelemetry object
    is_mock      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telemetry_job_id ON telemetry (job_id);

-- ── agent_runs ───────────────────────────────────────────────────────────────
-- Audit log of every agent execution attempt.
CREATE TABLE IF NOT EXISTS agent_runs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id       TEXT NOT NULL,
    agent_type   TEXT NOT NULL CHECK (agent_type IN ('form', 'prescriber')),
    agent_address TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'running', 'success', 'failed')),
    attempt      INTEGER NOT NULL DEFAULT 1,
    error_msg    TEXT,
    tx_hash      TEXT,
    ipfs_cid     TEXT,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_job_id ON agent_runs (job_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs (status);

-- ── upload_sessions ───────────────────────────────────────────────────────────
-- Short-lived SIWE upload sessions (can be backed by Supabase instead of memory).
CREATE TABLE IF NOT EXISTS upload_sessions (
    token          TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_wallet  ON upload_sessions (wallet_address);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires ON upload_sessions (expires_at);

-- Auto-cleanup of expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS void AS $$
    DELETE FROM upload_sessions WHERE expires_at < NOW();
$$ LANGUAGE SQL;

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER receipts_updated_at
    BEFORE UPDATE ON receipts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER athletes_updated_at
    BEFORE UPDATE ON athletes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row Level Security (RLS) ─────────────────────────────────────────────────
-- Strategy:
--   • The velo-agents service key bypasses RLS entirely (all writes go through it).
--   • The anon key is PUBLIC-READ-ONLY for the tables the frontend reads directly
--     (receipts, jobs, athletes, tapes) and has NO access at all to sensitive
--     tables (telemetry, agent_runs, upload_sessions).
--   • No table grants anon INSERT/UPDATE/DELETE — every mutation is mediated by
--     the authenticated /api routes.

ALTER TABLE receipts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE athletes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tapes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster          ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_sessions ENABLE ROW LEVEL SECURITY;

-- Public (anon) read-only policies for frontend-facing tables.
DROP POLICY IF EXISTS "receipts_read_public" ON receipts;
CREATE POLICY "receipts_read_public" ON receipts
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "jobs_read_public" ON jobs;
CREATE POLICY "jobs_read_public" ON jobs
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "athletes_read_public" ON athletes;
CREATE POLICY "athletes_read_public" ON athletes
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "tapes_read_public" ON tapes;
CREATE POLICY "tapes_read_public" ON tapes
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "roster_read_public" ON roster;
CREATE POLICY "roster_read_public" ON roster
    FOR SELECT USING (true);

-- telemetry, agent_runs and upload_sessions have RLS enabled but NO policies,
-- so the anon key can neither read nor write them. Only the service key (which
-- bypasses RLS) touches these tables, via the agent runner.

-- ════════════════════════════════════════════════════════════════════════════
-- Sample queries used by the API server
-- ════════════════════════════════════════════════════════════════════════════

-- GET /api/receipts/:jobId
-- SELECT * FROM receipts WHERE job_id = $1;

-- Athlete dashboard — all completed jobs
-- SELECT j.*, r.form_receipt, r.prescription_receipt
-- FROM jobs j
-- LEFT JOIN receipts r ON j.job_id = r.job_id
-- WHERE j.athlete_address = $1 AND j.status = 'completed'
-- ORDER BY j.created_at DESC;

-- Agent run history
-- SELECT * FROM agent_runs WHERE job_id = $1 ORDER BY started_at;
