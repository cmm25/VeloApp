import type { StoredReceipt } from "../ai/schemas.js";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";

const log = makeLogger("store");

function supabaseEnabled(): boolean {
  return !!(config.supabase.url && config.supabase.serviceKey);
}

async function getSupabase() {
  const { createClient } = await import("@supabase/supabase-js").catch(() => {
    throw new Error("@supabase/supabase-js not installed");
  });
  return createClient(config.supabase.url, config.supabase.serviceKey);
}

// ── Receipts ──────────────────────────────────────────────────────────────────
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

// ── Tapes ─────────────────────────────────────────────────────────────────────
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

// ── Athletes ──────────────────────────────────────────────────────────────────
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
