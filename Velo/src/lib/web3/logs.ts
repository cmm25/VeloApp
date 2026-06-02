import type { Address, AbiEvent } from "viem";
import type { usePublicClient } from "wagmi";

type Client = NonNullable<ReturnType<typeof usePublicClient>>;

/**
 * Somnia's `eth_getLogs` rejects any range wider than 1000 blocks
 * ("block range exceeds 1000"). Every log scan must therefore be split into
 * windows no larger than this and stitched back together. A naive
 * `fromBlock: 0n` scan against the live chain (hundreds of millions of blocks)
 * is impossible, so callers must always bound the range — either explicitly or
 * via {@link getRecentLogs}.
 */
export const MAX_LOG_RANGE = 1000n;

/** Approximate Somnia block time (~10 blocks/sec) for timestamp→block math. */
export const SOMNIA_BLOCKS_PER_SEC = 10n;

type GetLogsArgs = {
  address: Address;
  event: AbiEvent;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
  /** How many ≤1000-block windows to fetch at once. */
  concurrency?: number;
};

/**
 * Scan `[fromBlock, toBlock]` for a single event in ≤1000-block windows,
 * fetched with bounded concurrency, and return the flattened logs in
 * block order. Safe against Somnia's 1000-block getLogs cap.
 */
export async function getLogsChunked(
  client: Client,
  { address, event, args, fromBlock, toBlock, concurrency = 5 }: GetLogsArgs,
): Promise<unknown[]> {
  if (toBlock < fromBlock) return [];

  // Build the list of non-overlapping ≤1000-block windows.
  const windows: { from: bigint; to: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE) {
    const end =
      start + MAX_LOG_RANGE - 1n > toBlock ? toBlock : start + MAX_LOG_RANGE - 1n;
    windows.push({ from: start, to: end });
  }

  const collected: { idx: number; logs: unknown[] }[] = [];
  for (let i = 0; i < windows.length; i += concurrency) {
    const batch = windows.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (w, j) => {
        const logs = await client.getLogs({
          address,
          event: event as never,
          args: args as never,
          fromBlock: w.from,
          toBlock: w.to,
        });
        return { idx: i + j, logs: logs as unknown[] };
      }),
    );
    collected.push(...results);
  }

  return collected.sort((a, b) => a.idx - b.idx).flatMap((r) => r.logs);
}

type RecentLogsArgs = {
  address: Address;
  event: AbiEvent;
  args?: Record<string, unknown>;
  /**
   * How far back to scan, in blocks, from the chain head. Defaults to ~50k
   * blocks (≈1.5h at Somnia's cadence). Keep this modest — each 1000-block
   * window is one RPC round-trip.
   */
  lookbackBlocks?: bigint;
  concurrency?: number;
};

/**
 * Scan only the most recent `lookbackBlocks` for an event, bounded to ≤1000-block
 * windows. Use this anywhere a full-history scan is impossible (which is always,
 * on Somnia) and a recent window is good enough — recent activity strips,
 * on-demand receipt-signature lookups, recently-settled bounty splits, etc.
 */
export async function getRecentLogs(
  client: Client,
  { address, event, args, lookbackBlocks = 50_000n, concurrency = 5 }: RecentLogsArgs,
): Promise<unknown[]> {
  const head = await client.getBlockNumber();
  const fromBlock = head > lookbackBlocks ? head - lookbackBlocks : 0n;
  return getLogsChunked(client, {
    address,
    event,
    args,
    fromBlock,
    toBlock: head,
    concurrency,
  });
}

/**
 * Estimate the earliest block that could contain an event for something created
 * at `createdAtSec` (unix seconds), clamped so the scan never exceeds `maxRange`
 * blocks back from the head. Returns `{ fromBlock, toBlock, capped }` where
 * `capped` flags that the window was clamped and results may be partial.
 *
 * This lets a per-entity scan (e.g. one bounty's Settled event) bound itself to
 * roughly that entity's lifetime instead of all of history.
 */
export async function recentRangeForTimestamp(
  client: Client,
  createdAtSec: bigint,
  maxRange = 300_000n,
): Promise<{ fromBlock: bigint; toBlock: bigint; capped: boolean }> {
  const head = await client.getBlockNumber();
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const ageSec = nowSec > createdAtSec ? nowSec - createdAtSec : 0n;
  // Add a generous buffer so clock skew / variable block time can't clip the
  // window before the first event.
  const span = ageSec * SOMNIA_BLOCKS_PER_SEC + 5_000n;
  const capped = span > maxRange;
  const range = capped ? maxRange : span;
  const fromBlock = head > range ? head - range : 0n;
  return { fromBlock, toBlock: head, capped };
}
