/**
 * Indexer client — fetches `{ receipt, signature }` per jobId from the
 * api-server's `/api/receipts/:jobId` endpoint so the browser can re-derive
 * the EIP-712 digest and recover the agent's signing address locally.
 *
 * Returns `null` (instead of throwing) when the indexer is not configured or
 * does not yet have a record, so the UI can degrade gracefully to the
 * on-chain calldata path.
 */
import type { Address, Hex } from "viem";
import type { ReceiptStruct } from "./eip712";

const apiBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

type RawReceipt = {
  jobId: Hex;
  agent: Address;
  ipfsCid: string;
  summaryHash: Hex;
  summary: string;
  nonce: string;
  deadline: string;
  priorReceiptHash: Hex;
};

export type SomniaAgentReceiptRef = {
  requestId: string;
  agentId: string;
  txHash: Hex;
  consensusStatus: string;
  receipt: string | null;
  receiptUrl: string;
};

export type AiProvenance = {
  path: "native" | "fallback";
  agentType: "llm-inference";
  somnia?: SomniaAgentReceiptRef;
  fallbackReason?: string;
};

type RawEntry = {
  receipt: RawReceipt;
  signature: Hex;
  txHash: Hex;
  blockNumber: string;
  provenance?: AiProvenance | null;
};

type RawResponse = {
  jobId: Hex;
  orchestrator: Address;
  chainId: number;
  form: RawEntry | null;
  prescription: RawEntry | null;
};

export type IndexedEntry = {
  receipt: ReceiptStruct;
  signature: Hex;
  txHash: Hex;
  blockNumber: bigint;
  provenance: AiProvenance | null;
};

export type IndexedReceipts = {
  jobId: Hex;
  orchestrator: Address;
  chainId: number;
  form: IndexedEntry | null;
  prescription: IndexedEntry | null;
};

function hydrate(entry: RawEntry | null): IndexedEntry | null {
  if (!entry) return null;
  const r = entry.receipt;
  return {
    receipt: {
      jobId: r.jobId,
      agent: r.agent,
      ipfsCid: r.ipfsCid,
      summaryHash: r.summaryHash,
      summary: r.summary,
      nonce: BigInt(r.nonce),
      deadline: BigInt(r.deadline),
      priorReceiptHash: r.priorReceiptHash,
    },
    signature: entry.signature,
    txHash: entry.txHash,
    blockNumber: BigInt(entry.blockNumber),
    provenance: entry.provenance ?? null,
  };
}

export type IndexerStatus = "ready" | "not-configured" | "error";

export type FetchReceiptsResult =
  | { status: "ready"; data: IndexedReceipts; latencyMs: number }
  | { status: "not-configured"; reason: string; latencyMs: number }
  | { status: "error"; reason: string; latencyMs: number };

export async function fetchIndexedReceipts(
  jobId: Hex,
): Promise<FetchReceiptsResult> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${apiBase}/receipts/${jobId}`, {
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    return { status: "error", reason: (err as Error).message, latencyMs: Math.round(performance.now() - t0) };
  }
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    return {
      status: "not-configured",
      reason: body.detail ?? "indexer not configured",
      latencyMs: Math.round(performance.now() - t0),
    };
  }
  if (!res.ok) {
    return { status: "error", reason: `HTTP ${res.status}`, latencyMs: Math.round(performance.now() - t0) };
  }
  const body = (await res.json()) as RawResponse;
  return {
    status: "ready",
    latencyMs: Math.round(performance.now() - t0),
    data: {
      jobId: body.jobId,
      orchestrator: body.orchestrator,
      chainId: body.chainId,
      form: hydrate(body.form),
      prescription: hydrate(body.prescription),
    },
  };
}

export type IndexerHealth =
  | { status: "ready"; latencyMs: number; at: number }
  | { status: "waking"; reason: string; latencyMs: number; at: number }
  | { status: "down"; reason: string; latencyMs: number; at: number };

/**
 * A backend hosted on a free tier (Render) sleeps after idle and the first
 * request wakes it, which surfaces as a network error or a transient
 * 502/503/504 for a few seconds. Treat those as "waking" (retry) rather than
 * a hard "down" so the UI can show a friendly spin-up state instead of an
 * alarming failure during the first interaction of a demo.
 */
function isTransientWakeStatus(httpStatus: number): boolean {
  return httpStatus === 502 || httpStatus === 503 || httpStatus === 504;
}

/**
 * Single ping. Classifies a transient cold-start signal as "waking"; a fetch
 * that throws (network/DNS/connection refused while the dyno boots) is also
 * "waking". Any other non-ok response is a real "down".
 */
export async function pingIndexer(signal?: AbortSignal): Promise<IndexerHealth> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${apiBase}/healthz`, {
      headers: { Accept: "application/json" },
      signal,
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (res.ok) return { status: "ready", latencyMs, at: Date.now() };
    if (isTransientWakeStatus(res.status)) {
      return { status: "waking", reason: `HTTP ${res.status}`, latencyMs, at: Date.now() };
    }
    return { status: "down", reason: `HTTP ${res.status}`, latencyMs, at: Date.now() };
  } catch (err) {
    // A thrown fetch during boot looks identical to an outage; prefer the
    // optimistic "waking" reading — the retrying caller downgrades to "down"
    // only after the attempt budget is exhausted.
    return {
      status: "waking",
      reason: (err as Error).message,
      latencyMs: Math.round(performance.now() - t0),
      at: Date.now(),
    };
  }
}

/**
 * Ping with bounded exponential backoff. Resolves "ready" as soon as the
 * backend answers, keeps reporting "waking" via `onAttempt` between tries, and
 * resolves "down" only after `maxAttempts` transient failures — so a normal
 * cold start shows the spin-up state and a genuine outage still ends in a clear
 * error. `signal` lets a caller abort when it unmounts.
 */
export async function pingIndexerWithRetry(opts?: {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onAttempt?: (health: IndexerHealth, attempt: number) => void;
  signal?: AbortSignal;
}): Promise<IndexerHealth> {
  const maxAttempts = opts?.maxAttempts ?? 6;
  const baseDelayMs = opts?.baseDelayMs ?? 1500;
  const maxDelayMs = opts?.maxDelayMs ?? 8000;

  let last: IndexerHealth = { status: "waking", reason: "starting", latencyMs: 0, at: Date.now() };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts?.signal?.aborted) return last;
    last = await pingIndexer(opts?.signal);
    if (last.status === "ready" || last.status === "down") {
      opts?.onAttempt?.(last, attempt);
      return last;
    }
    // still waking
    opts?.onAttempt?.(last, attempt);
    if (attempt < maxAttempts) {
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise<void>((resolve) => {
        const id = setTimeout(resolve, delay);
        opts?.signal?.addEventListener("abort", () => {
          clearTimeout(id);
          resolve();
        }, { once: true });
      });
    }
  }
  // Budget exhausted while still transiently failing → treat as down.
  return { status: "down", reason: last.reason ?? "unreachable", latencyMs: last.latencyMs, at: Date.now() };
}
