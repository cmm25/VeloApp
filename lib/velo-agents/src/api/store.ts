import type { StoredReceipt } from "../ai/schemas.js";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";

const log = makeLogger("store");

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>;
    const message = typeof anyErr["message"] === "string" ? anyErr["message"] : "";
    const code = typeof anyErr["code"] === "string" ? anyErr["code"] : "";
    const details = typeof anyErr["details"] === "string" ? anyErr["details"] : "";
    const hint = typeof anyErr["hint"] === "string" ? anyErr["hint"] : "";
    const parts = [message, code && `code=${code}`, details && `details=${details}`, hint && `hint=${hint}`]
      .filter(Boolean)
      .join(" | ");
    if (parts) return parts;
    try {
      return JSON.stringify(anyErr);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function supabaseEnabled(): boolean {
  return !!(config.supabase.url && config.supabase.serviceKey);
}

async function getSupabase() {
  const { createClient } = await import("@supabase/supabase-js").catch(() => {
    throw new Error("@supabase/supabase-js not installed");
  });
  return createClient(config.supabase.url, config.supabase.serviceKey);
}

// Receipts
// In-memory store (replaced by Supabase when SUPABASE_URL is set)
const _receipts = new Map<string, StoredReceipt>();

export async function upsertReceipt(data: StoredReceipt): Promise<void> {
  const jobId = data.jobId.toLowerCase();
  const existing = _receipts.get(jobId) ?? data;
  const merged: StoredReceipt = {
    ...existing,
    form: data.form ?? existing.form,
    prescription: data.prescription ?? existing.prescription,
  };
  _receipts.set(jobId, merged);
  log.debug("Receipt stored", { jobId, hasForm: !!merged.form, hasPrescription: !!merged.prescription });

  if (supabaseEnabled()) {
    await upsertReceiptToSupabase(merged);
  }
}

export async function getReceipt(jobId: string): Promise<StoredReceipt | null> {
  const key = jobId.toLowerCase();
  const local = _receipts.get(key);
  if (local) return local;

  if (supabaseEnabled()) {
    return await fetchReceiptFromSupabase(key);
  }

  return null;
}

export function listReceipts(): StoredReceipt[] {
  return Array.from(_receipts.values());
}

async function upsertReceiptToSupabase(data: StoredReceipt): Promise<void> {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase
      .from("receipts")
      .upsert(
        {
          job_id: data.jobId.toLowerCase(),
          orchestrator: data.orchestrator,
          chain_id: data.chainId,
          form_receipt: data.form ? JSON.stringify(data.form) : null,
          prescription_receipt: data.prescription ? JSON.stringify(data.prescription) : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id" }
      );
    if (error) log.warn("Supabase upsert error", error);
    else log.debug("Supabase upsert ok", { jobId: data.jobId });
  } catch (err) {
    log.warn("Supabase write failed (falling back to in-memory)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function fetchReceiptFromSupabase(jobId: string): Promise<StoredReceipt | null> {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("receipts")
      .select("*")
      .eq("job_id", jobId.toLowerCase())
      .single();

    if (error || !data) return null;
    return {
      jobId: data.job_id,
      orchestrator: data.orchestrator,
      chainId: data.chain_id,
      form: data.form_receipt ? JSON.parse(data.form_receipt) : null,
      prescription: data.prescription_receipt ? JSON.parse(data.prescription_receipt) : null,
    };
  } catch (err) {
    log.warn("Supabase fetch failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// Tapes
// Athlete-owned video library. Shape mirrors Velo/src/lib/domain/tapes.ts.
export type Tape = {
  id: number;
  address: string;
  cid: string;
  label: string | null;
  sizeBytes: number | null;
  contentType: string | null;
  createdAt: string;
};

export type NewTapeInput = {
  cid: string;
  label?: string | null;
  sizeBytes?: number | null;
  contentType?: string | null;
};

// In-memory store (used when Supabase is not configured)
const _tapes: Tape[] = [];
let _tapeSeq = 1;

export async function listTapes(address: string): Promise<Tape[]> {
  const owner = address.toLowerCase();

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("tapes")
        .select("*")
        .eq("wallet_address", owner)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(rowToTape);
    } catch (err) {
      log.warn("Supabase tapes list failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return _tapes
    .filter((t) => t.address === owner)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addTape(address: string, input: NewTapeInput): Promise<Tape> {
  const owner = address.toLowerCase();
  const now = new Date().toISOString();

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("tapes")
        .insert({
          wallet_address: owner,
          cid: input.cid,
          label: input.label ?? null,
          size_bytes: input.sizeBytes ?? null,
          content_type: input.contentType ?? null,
          created_at: now,
        })
        .select("*")
        .single();
      if (error) throw error;
      return rowToTape(data);
    } catch (err) {
      log.warn("Supabase tape insert failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const tape: Tape = {
    id: _tapeSeq++,
    address: owner,
    cid: input.cid,
    label: input.label ?? null,
    sizeBytes: input.sizeBytes ?? null,
    contentType: input.contentType ?? null,
    createdAt: now,
  };
  _tapes.push(tape);
  return tape;
}

/**
 * Deletes a tape only if it belongs to `address`.
 * Returns "deleted" | "not_found" | "forbidden".
 */
export async function removeTape(
  id: number,
  address: string
): Promise<"deleted" | "not_found" | "forbidden"> {
  const owner = address.toLowerCase();

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data: existing, error: selErr } = await supabase
        .from("tapes")
        .select("wallet_address")
        .eq("id", id)
        .single();
      if (selErr || !existing) return "not_found";
      if (existing.wallet_address.toLowerCase() !== owner) return "forbidden";
      const { error } = await supabase.from("tapes").delete().eq("id", id);
      if (error) throw error;
      return "deleted";
    } catch (err) {
      log.warn("Supabase tape delete failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const idx = _tapes.findIndex((t) => t.id === id);
  if (idx === -1) return "not_found";
  if (_tapes[idx].address !== owner) return "forbidden";
  _tapes.splice(idx, 1);
  return "deleted";
}

function rowToTape(row: Record<string, unknown>): Tape {
  return {
    id: Number(row["id"]),
    address: String(row["wallet_address"]).toLowerCase(),
    cid: String(row["cid"]),
    label: (row["label"] as string | null) ?? null,
    sizeBytes: row["size_bytes"] != null ? Number(row["size_bytes"]) : null,
    contentType: (row["content_type"] as string | null) ?? null,
    createdAt: String(row["created_at"]),
  };
}

// Athletes
// Shared display-name directory. Shape mirrors Velo/src/lib/domain/athletes.ts.
export type ApiAthlete = {
  address: string;
  name: string;
  updatedAt: string;
};

const _athletes = new Map<string, ApiAthlete>();

export async function listAthletes(): Promise<ApiAthlete[]> {
  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("athletes")
        .select("wallet_address, display_name, updated_at")
        .not("display_name", "is", null);
      if (error) throw error;
      type AthleteRow = { wallet_address: string; display_name: string | null; updated_at: string };
      return ((data ?? []) as AthleteRow[])
        .filter((r) => r.display_name)
        .map((r) => ({
          address: String(r.wallet_address).toLowerCase(),
          name: String(r.display_name),
          updatedAt: String(r.updated_at),
        }));
    } catch (err) {
      log.warn("Supabase athletes list failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return Array.from(_athletes.values());
}

export async function upsertAthlete(address: string, name: string): Promise<ApiAthlete> {
  const owner = address.toLowerCase();
  const trimmed = name.trim();
  const now = new Date().toISOString();
  const record: ApiAthlete = { address: owner, name: trimmed, updatedAt: now };

  _athletes.set(owner, record);

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { error } = await supabase
        .from("athletes")
        .upsert(
          {
            wallet_address: owner,
            display_name: trimmed,
            updated_at: now,
          },
          { onConflict: "wallet_address" }
        );
      if (error) throw error;
    } catch (err) {
      log.warn("Supabase athlete upsert failed (kept in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return record;
}

/**
 * Resolves a wallet's display name from the shared directory, or null.
 * Checks the in-memory directory first, then Supabase when configured.
 */
async function resolveDisplayName(address: string): Promise<string | null> {
  const owner = address.toLowerCase();
  const local = _athletes.get(owner);
  if (local) return local.name;

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("athletes")
        .select("display_name")
        .eq("wallet_address", owner)
        .single();
      if (error || !data) return null;
      return (data.display_name as string | null) ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

// Roster + invite requests
// Off-chain coach↔athlete links. A coach invites an athlete by wallet address,
// which creates a `pending` row; the athlete accepts (→ `active`) or declines
// (→ deleted). Shapes mirror Velo/src/lib/domain/roster.ts (RosterEntry,
// RosterRequest, CoachLink).
export type RosterRow = {
  id: number;
  coachAddress: string;
  athleteAddress: string;
  label: string | null;
  source: string;
  inviteId: string | null;
  status: "active" | "pending";
  createdAt: string;
  acceptedAt: string | null;
};

export type RosterEntry = RosterRow & { athleteName: string | null };
export type RosterRequest = {
  id: number;
  coachAddress: string;
  coachName: string | null;
  label: string | null;
  source: string;
  createdAt: string;
};
export type CoachLink = {
  coachAddress: string;
  coachName: string | null;
  source: string;
  createdAt: string;
};

export type RosterMutationResult = "ok" | "not_found" | "forbidden";

const _roster: RosterRow[] = [];
let _rosterSeq = 1;

function rowToRoster(row: Record<string, unknown>): RosterRow {
  return {
    id: Number(row["id"]),
    coachAddress: String(row["coach_address"]).toLowerCase(),
    athleteAddress: String(row["athlete_address"]).toLowerCase(),
    label: (row["label"] as string | null) ?? null,
    source: String(row["source"] ?? "address"),
    inviteId: (row["invite_id"] as string | null) ?? null,
    status: (String(row["status"]) === "active" ? "active" : "pending"),
    createdAt: String(row["created_at"]),
    acceptedAt: (row["accepted_at"] as string | null) ?? null,
  };
}

async function withAthleteName(row: RosterRow): Promise<RosterEntry> {
  return { ...row, athleteName: await resolveDisplayName(row.athleteAddress) };
}

/**
 * Creates a pending invite from coach→athlete. Throws "already_on_roster" if a
 * row (active or pending) already exists for that pair.
 */
export async function createRosterInvite(
  coachAddress: string,
  athleteAddress: string,
  label: string | null
): Promise<RosterEntry> {
  const coach = coachAddress.toLowerCase();
  const athlete = athleteAddress.toLowerCase();
  const now = new Date().toISOString();

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data: existing, error: selErr } = await supabase
        .from("roster")
        .select("id")
        .eq("coach_address", coach)
        .eq("athlete_address", athlete)
        .maybeSingle();
      if (selErr) throw selErr;
      if (existing) throw new Error("already_on_roster");
      const { data, error } = await supabase
        .from("roster")
        .insert({
          coach_address: coach,
          athlete_address: athlete,
          label: label ?? null,
          source: "address",
          status: "pending",
          created_at: now,
        })
        .select("*")
        .single();
      if (error) throw error;
      return withAthleteName(rowToRoster(data));
    } catch (err) {
      if (err instanceof Error && err.message === "already_on_roster") throw err;
      log.warn("Supabase roster insert failed (falling back to in-memory)", {
        error: describeError(err),
      });
    }
  }

  if (_roster.some((r) => r.coachAddress === coach && r.athleteAddress === athlete)) {
    throw new Error("already_on_roster");
  }
  const row: RosterRow = {
    id: _rosterSeq++,
    coachAddress: coach,
    athleteAddress: athlete,
    label: label ?? null,
    source: "address",
    inviteId: null,
    status: "pending",
    createdAt: now,
    acceptedAt: null,
  };
  _roster.push(row);
  return withAthleteName(row);
}

async function listRosterByCoach(
  coachAddress: string,
  status: "active" | "pending"
): Promise<RosterEntry[]> {
  const coach = coachAddress.toLowerCase();

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("roster")
        .select("*")
        .eq("coach_address", coach)
        .eq("status", status)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return Promise.all(
        ((data ?? []) as RosterRow[]).map((r) => withAthleteName(rowToRoster(r))),
      );
    } catch (err) {
      log.warn("Supabase roster list failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const rows = _roster
    .filter((r) => r.coachAddress === coach && r.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Promise.all(rows.map(withAthleteName));
}

export function listCoachRoster(coachAddress: string): Promise<RosterEntry[]> {
  return listRosterByCoach(coachAddress, "active");
}

export function listCoachPendingRoster(coachAddress: string): Promise<RosterEntry[]> {
  return listRosterByCoach(coachAddress, "pending");
}

/**
 * Removes any roster row (active or pending) for the coach+athlete pair.
 * Only the owning coach may remove. Returns "ok" | "not_found".
 */
export async function removeRosterEntry(
  coachAddress: string,
  athleteAddress: string
): Promise<RosterMutationResult> {
  const coach = coachAddress.toLowerCase();
  const athlete = athleteAddress.toLowerCase();

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data: existing, error: selErr } = await supabase
        .from("roster")
        .select("id")
        .eq("coach_address", coach)
        .eq("athlete_address", athlete)
        .maybeSingle();
      if (selErr) throw selErr;
      if (!existing) return "not_found";
      const { error } = await supabase.from("roster").delete().eq("id", existing.id);
      if (error) throw error;
      return "ok";
    } catch (err) {
      log.warn("Supabase roster delete failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const idx = _roster.findIndex(
    (r) => r.coachAddress === coach && r.athleteAddress === athlete
  );
  if (idx === -1) return "not_found";
  _roster.splice(idx, 1);
  return "ok";
}

async function listCoachLinks(athleteAddress: string): Promise<CoachLink[]> {
  const athlete = athleteAddress.toLowerCase();

  let rows: RosterRow[];
  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("roster")
        .select("*")
        .eq("athlete_address", athlete)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      rows = (data ?? []).map(rowToRoster);
    } catch (err) {
      log.warn("Supabase coach-link list failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
      rows = _roster.filter((r) => r.athleteAddress === athlete && r.status === "active");
    }
  } else {
    rows = _roster
      .filter((r) => r.athleteAddress === athlete && r.status === "active")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return Promise.all(
    rows.map(async (r) => ({
      coachAddress: r.coachAddress,
      coachName: await resolveDisplayName(r.coachAddress),
      source: r.source,
      createdAt: r.acceptedAt ?? r.createdAt,
    }))
  );
}

/** Public + athlete-facing: active coaches linked to an athlete. */
export function listCoachesForAthlete(athleteAddress: string): Promise<CoachLink[]> {
  return listCoachLinks(athleteAddress);
}

/** Athlete-facing: incoming pending invites for an athlete. */
export async function listAthleteRosterRequests(
  athleteAddress: string
): Promise<RosterRequest[]> {
  const athlete = athleteAddress.toLowerCase();

  let rows: RosterRow[];
  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase
        .from("roster")
        .select("*")
        .eq("athlete_address", athlete)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      rows = (data ?? []).map(rowToRoster);
    } catch (err) {
      log.warn("Supabase roster-request list failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
      rows = _roster.filter((r) => r.athleteAddress === athlete && r.status === "pending");
    }
  } else {
    rows = _roster
      .filter((r) => r.athleteAddress === athlete && r.status === "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      coachAddress: r.coachAddress,
      coachName: await resolveDisplayName(r.coachAddress),
      label: r.label,
      source: r.source,
      createdAt: r.createdAt,
    }))
  );
}

/**
 * Athlete accepts a pending invite addressed to them. Only the athlete the
 * invite targets may accept. Returns "ok" | "not_found" | "forbidden".
 */
export async function acceptRosterRequest(
  id: number,
  athleteAddress: string
): Promise<RosterMutationResult> {
  const athlete = athleteAddress.toLowerCase();
  const now = new Date().toISOString();

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data: existing, error: selErr } = await supabase
        .from("roster")
        .select("athlete_address, status")
        .eq("id", id)
        .maybeSingle();
      if (selErr) throw selErr;
      if (!existing) return "not_found";
      if (String(existing.athlete_address).toLowerCase() !== athlete) return "forbidden";
      const { error } = await supabase
        .from("roster")
        .update({ status: "active", accepted_at: now })
        .eq("id", id);
      if (error) throw error;
      return "ok";
    } catch (err) {
      log.warn("Supabase roster accept failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const row = _roster.find((r) => r.id === id);
  if (!row) return "not_found";
  if (row.athleteAddress !== athlete) return "forbidden";
  row.status = "active";
  row.acceptedAt = now;
  return "ok";
}

/**
 * Athlete declines a pending invite addressed to them (deletes the row). Only
 * the athlete the invite targets may decline. Returns the mutation result.
 */
export async function declineRosterRequest(
  id: number,
  athleteAddress: string
): Promise<RosterMutationResult> {
  const athlete = athleteAddress.toLowerCase();

  if (supabaseEnabled()) {
    try {
      const supabase = await getSupabase();
      const { data: existing, error: selErr } = await supabase
        .from("roster")
        .select("athlete_address")
        .eq("id", id)
        .maybeSingle();
      if (selErr) throw selErr;
      if (!existing) return "not_found";
      if (String(existing.athlete_address).toLowerCase() !== athlete) return "forbidden";
      const { error } = await supabase.from("roster").delete().eq("id", id);
      if (error) throw error;
      return "ok";
    } catch (err) {
      log.warn("Supabase roster decline failed (falling back to in-memory)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const idx = _roster.findIndex((r) => r.id === id);
  if (idx === -1) return "not_found";
  if (_roster[idx].athleteAddress !== athlete) return "forbidden";
  _roster.splice(idx, 1);
  return "ok";
}
