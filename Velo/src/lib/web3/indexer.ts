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
  | { status: "down"; reason: string; latencyMs: number; at: number };

export async function pingIndexer(): Promise<IndexerHealth> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${apiBase}/healthz`, { headers: { Accept: "application/json" } });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) return { status: "down", reason: `HTTP ${res.status}`, latencyMs, at: Date.now() };
    return { status: "ready", latencyMs, at: Date.now() };
  } catch (err) {
    return {
      status: "down",
      reason: (err as Error).message,
      latencyMs: Math.round(performance.now() - t0),
      at: Date.now(),
    };
  }
}
