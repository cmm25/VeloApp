import type { StoredReceipt } from "../ai/schemas.js";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";

const log = makeLogger("store");

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

  if (config.supabase.url && config.supabase.serviceKey) {
    await upsertToSupabase(merged);
  }
}

export async function getReceipt(jobId: string): Promise<StoredReceipt | null> {
  const key = jobId.toLowerCase();
  const local = _receipts.get(key);
  if (local) return local;

  if (config.supabase.url && config.supabase.serviceKey) {
    return await fetchFromSupabase(jobId);
  }

  return null;
}

export function listReceipts(): StoredReceipt[] {
  return Array.from(_receipts.values());
}

// ── Supabase integration (activated when env vars are set) ────────────────────

async function upsertToSupabase(data: StoredReceipt): Promise<void> {
  try {
    const { createClient } = await import("@supabase/supabase-js").catch(() => {
      throw new Error("@supabase/supabase-js not installed");
    });
    const supabase = createClient(config.supabase.url, config.supabase.serviceKey);
    const { error } = await supabase
      .from("receipts")
      .upsert(
        {
          job_id: data.jobId,
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

async function fetchFromSupabase(jobId: string): Promise<StoredReceipt | null> {
  try {
    const { createClient } = await import("@supabase/supabase-js").catch(() => {
      throw new Error("@supabase/supabase-js not installed");
    });
    const supabase = createClient(config.supabase.url, config.supabase.serviceKey);
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
