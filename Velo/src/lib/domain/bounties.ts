import { useMemo } from "react";
import {
  useReadContract,
  useReadContracts,
  useWriteContract,
  usePublicClient,
  useWatchContractEvent,
} from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseEther,
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hex,
  type AbiEvent,
} from "viem";
import { bountyExtensionAbi } from "@/lib/web3/abis";
import { bountyExtensionAddress } from "@/hooks/useVeloContracts";
import { somniaTestnet } from "@/lib/web3/chain";
import { getLogsChunked, recentRangeForTimestamp } from "@/lib/web3/logs";

export type BountyStatus = "None" | "Open" | "Accepted" | "Settled" | "Expired";

// On-chain enum: None=0, Open=1, Accepted=2, Settled=3, Expired=4.
const BOUNTY_STATUS: BountyStatus[] = [
  "None",
  "Open",
  "Accepted",
  "Settled",
  "Expired",
];

export type Bounty = {
  id: bigint;
  poster: Address;
  athlete: Address;
  videoCid: string;
  deadline: bigint;
  createdAt: bigint;
  escrow: bigint;
  leadAgent: Address;
  acceptedFee: bigint;
  status: BountyStatus;
  requiredSkills: Hex[];
};

export type Bid = {
  bidId: bigint;
  agent: Address;
  proposedFee: bigint;
  proposedDeadline: bigint;
  placedAt: bigint;
};

function decodeBounty(id: bigint, raw: unknown): Bounty | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const statusIdx = Number(r.status ?? 0);
  return {
    id,
    poster: r.poster as Address,
    athlete: r.athlete as Address,
    videoCid: (r.videoCid as string) ?? "",
    deadline: (r.deadline as bigint) ?? 0n,
    createdAt: (r.createdAt as bigint) ?? 0n,
    escrow: (r.escrow as bigint) ?? 0n,
    leadAgent: r.leadAgent as Address,
    acceptedFee: (r.acceptedFee as bigint) ?? 0n,
    status: BOUNTY_STATUS[statusIdx] ?? "Open",
    requiredSkills: ((r.requiredSkills as Hex[]) ?? []) as Hex[],
  };
}

/**
 * Every bounty, enumerated via the on-chain `nextBountyId` counter.
 *
 * Bounties are sequential — `BountyExtension` assigns `bountyId = nextBountyId++`
 * starting at 1 — so the full set is `[1, nextBountyId)`. We read the counter and
 * multicall `getBounty(id)` for each, which sidesteps `eth_getLogs` entirely (and
 * thus Somnia's 1000-block scan cap that made a `fromBlock: 0` log scan fail
 * outright). `decodeBounty` keeps anything with a real status; the "None" filter
 * drops ids that somehow don't resolve.
 */
export function useOpenBounties() {
  const ext = bountyExtensionAddress();
  const countQ = useReadContract({
    address: ext ?? undefined,
    abi: bountyExtensionAbi,
    functionName: "nextBountyId",
    query: { enabled: !!ext, staleTime: 0, refetchOnMount: true },
  });
  const next = countQ.data ? Number(countQ.data as bigint) : 0;
  const ids = useMemo<bigint[]>(
    () => (next > 1 ? Array.from({ length: next - 1 }, (_, i) => BigInt(i + 1)) : []),
    [next],
  );
  const detailsQ = useReadContracts({
    contracts: ids.map((id) => ({
      address: ext!,
      abi: bountyExtensionAbi,
      functionName: "getBounty" as const,
      args: [id] as const,
    })),
    query: { enabled: !!ext && ids.length > 0 },
  });
  const bounties = useMemo<Bounty[]>(() => {
    if (!detailsQ.data) return [];
    const out: Bounty[] = [];
    detailsQ.data.forEach((res, i) => {
      if (res.status === "success") {
        const b = decodeBounty(ids[i]!, res.result);
        if (b) out.push(b);
      }
    });
    return out
      .filter((b) => b.status !== "None")
      .sort((a, b) => Number(b.createdAt - a.createdAt));
  }, [detailsQ.data, ids]);
  return {
    bounties,
    isLoading: countQ.isLoading || (ids.length > 0 && detailsQ.isLoading),
    isError: countQ.isError,
    error: countQ.error,
    refetch: () => {
      countQ.refetch();
      detailsQ.refetch();
    },
  };
}

export function useBounty(id?: bigint) {
  const ext = bountyExtensionAddress();
  const enabled = !!ext && id !== undefined;
  const q = useReadContract({
    address: ext ?? undefined,
    abi: bountyExtensionAbi,
    functionName: "getBounty",
    args: id !== undefined ? [id] : undefined,
    query: { enabled },
  });
  return {
    ...q,
    data: q.data && id !== undefined ? decodeBounty(id, q.data) : null,
  };
}

export function useBids(id?: bigint) {
  const ext = bountyExtensionAddress();
  const enabled = !!ext && id !== undefined;
  const q = useReadContract({
    address: ext ?? undefined,
    abi: bountyExtensionAbi,
    functionName: "getBids",
    args: id !== undefined ? [id] : undefined,
    query: { enabled },
  });
  const bids = useMemo<Bid[]>(() => {
    if (!q.data || !Array.isArray(q.data)) return [];
    return (q.data as unknown[]).map((r, i) => {
      const x = r as Record<string, unknown>;
      return {
        bidId: BigInt(i),
        agent: x.agent as Address,
        proposedFee: (x.proposedFee as bigint) ?? 0n,
        proposedDeadline: (x.proposedDeadline as bigint) ?? 0n,
        placedAt: (x.placedAt as bigint) ?? 0n,
      };
    });
  }, [q.data]);
  return { ...q, bids };
}

export function useSubAgents(id?: bigint) {
  const ext = bountyExtensionAddress();
  const enabled = !!ext && id !== undefined;
  return useReadContract({
    address: ext ?? undefined,
    abi: bountyExtensionAbi,
    functionName: "getSubAgents",
    args: id !== undefined ? [id] : undefined,
    query: { enabled },
  });
}

export type TimelineEntry =
  // `ts` is unix seconds (0 when the exact moment isn't recoverable from state);
  // `seq` orders lifecycle phases when timestamps tie or are unknown.
  | { kind: "BountyPosted"; ts: number; seq: number; data: { escrow: bigint; deadline: bigint } }
  | {
      kind: "BidPlaced";
      ts: number;
      seq: number;
      data: { bidId: bigint; agent: Address; proposedFee: bigint };
    }
  | {
      kind: "BidAccepted";
      ts: number;
      seq: number;
      data: { bidId: bigint; leadAgent: Address; acceptedFee: bigint };
    }
  | { kind: "JobStarted"; ts: number; seq: number; data: { leadAgent: Address; deadline: bigint } }
  | { kind: "SubContracted"; ts: number; seq: number; data: { subAgent: Address } }
  | {
      kind: "Settled";
      ts: number;
      seq: number;
      data: { totalPaid: bigint; splits: { agent: Address; bps: number }[] };
    }
  | { kind: "BountyExpired"; ts: number; seq: number; data: { refund: bigint } };

type SettledLog = {
  blockNumber: bigint;
  args: { totalPaid?: bigint; splits?: unknown[] };
};

/**
 * Reconstruct a bounty's lifecycle timeline from on-chain *state* rather than a
 * full-history event scan (impossible on Somnia, which caps `eth_getLogs` at
 * 1000-block windows).
 *
 * `getBounty` + `getBids` + `getSubAgents` already capture everything except the
 * exact payout splits, which only exist in the `Settled` event. For settled
 * bounties we do a *bounded* recent scan (windowed to the bounty's lifetime via
 * `recentRangeForTimestamp`) to recover the real splits; if that window is too
 * old to reach the event we still emit a Settled entry with the accepted fee so
 * the timeline degrades gracefully instead of going blank.
 */
export function useBountyTimeline(id?: bigint) {
  const client = usePublicClient({ chainId: somniaTestnet.id });
  const ext = bountyExtensionAddress();
  const qc = useQueryClient();
  const key = ["velo:bounty:timeline", ext, id?.toString()] as const;

  const q = useQuery({
    queryKey: key,
    enabled: !!client && !!ext && id !== undefined,
    staleTime: 5_000,
    queryFn: async () => {
      const c = client!;
      const address = ext!;
      const bountyId = id!;

      const [rawBounty, rawBids, rawSubs] = await Promise.all([
        c.readContract({ address, abi: bountyExtensionAbi, functionName: "getBounty", args: [bountyId] }),
        c.readContract({ address, abi: bountyExtensionAbi, functionName: "getBids", args: [bountyId] }),
        c.readContract({ address, abi: bountyExtensionAbi, functionName: "getSubAgents", args: [bountyId] }),
      ]);

      const bounty = decodeBounty(bountyId, rawBounty);
      if (!bounty || bounty.status === "None") return [] as TimelineEntry[];

      const bids: Bid[] = Array.isArray(rawBids)
        ? (rawBids as unknown[]).map((r, i) => {
            const x = r as Record<string, unknown>;
            return {
              bidId: BigInt(i),
              agent: x.agent as Address,
              proposedFee: (x.proposedFee as bigint) ?? 0n,
              proposedDeadline: (x.proposedDeadline as bigint) ?? 0n,
              placedAt: (x.placedAt as bigint) ?? 0n,
            };
          })
        : [];
      const subs: Address[] = Array.isArray(rawSubs) ? (rawSubs as Address[]) : [];

      const out: TimelineEntry[] = [];

      out.push({
        kind: "BountyPosted",
        ts: Number(bounty.createdAt),
        seq: 0,
        data: { escrow: bounty.escrow, deadline: bounty.deadline },
      });

      for (const b of bids) {
        out.push({
          kind: "BidPlaced",
          ts: Number(b.placedAt),
          seq: 1,
          data: { bidId: b.bidId, agent: b.agent, proposedFee: b.proposedFee },
        });
      }

      const ZERO = "0x0000000000000000000000000000000000000000";
      const hasLead =
        !!bounty.leadAgent && bounty.leadAgent.toLowerCase() !== ZERO;
      const leadBid = hasLead
        ? bids.find((b) => b.agent.toLowerCase() === bounty.leadAgent.toLowerCase())
        : undefined;

      if (hasLead && (bounty.status === "Accepted" || bounty.status === "Settled")) {
        out.push({
          kind: "BidAccepted",
          ts: leadBid ? Number(leadBid.placedAt) : 0,
          seq: 2,
          data: {
            bidId: leadBid?.bidId ?? 0n,
            leadAgent: bounty.leadAgent,
            acceptedFee: bounty.acceptedFee,
          },
        });
      }

      for (const sub of subs) {
        out.push({ kind: "SubContracted", ts: 0, seq: 3, data: { subAgent: sub } });
      }

      if (bounty.status === "Settled") {
        let settled: { ts: number; totalPaid: bigint; splits: { agent: Address; bps: number }[] } | null =
          null;
        try {
          const event = bountyExtensionAbi.find(
            (x) => x.type === "event" && x.name === "Settled",
          );
          if (event) {
            const { fromBlock, toBlock } = await recentRangeForTimestamp(
              c,
              bounty.createdAt,
            );
            const logs = (await getLogsChunked(c, {
              address,
              event: event as AbiEvent,
              args: { bountyId },
              fromBlock,
              toBlock,
            })) as SettledLog[];
            const last = logs[logs.length - 1];
            if (last) {
              let ts = 0;
              try {
                const blk = await c.getBlock({ blockNumber: last.blockNumber });
                ts = Number(blk.timestamp);
              } catch {
                /* timestamp is best-effort */
              }
              settled = {
                ts,
                totalPaid: (last.args.totalPaid as bigint) ?? bounty.acceptedFee,
                splits: ((last.args.splits as unknown[]) ?? []).map((s) => {
                  const x = s as Record<string, unknown>;
                  return { agent: x.agent as Address, bps: Number(x.bps ?? 0) };
                }),
              };
            }
          }
        } catch {
          /* fall through to the graceful, splits-less entry below */
        }
        out.push({
          kind: "Settled",
          ts: settled?.ts ?? 0,
          seq: 4,
          data: {
            totalPaid: settled?.totalPaid ?? bounty.acceptedFee,
            splits: settled?.splits ?? [],
          },
        });
      }

      if (bounty.status === "Expired") {
        out.push({
          kind: "BountyExpired",
          ts: 0,
          seq: 4,
          data: { refund: bounty.escrow },
        });
      }

      out.sort((a, b) => (a.seq - b.seq) || (a.ts - b.ts));
      return out;
    },
  });

  useWatchContractEvent({
    address: ext ?? undefined,
    abi: bountyExtensionAbi,
    enabled: !!ext && id !== undefined,
    onLogs: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  return q;
}

// write hooks

/**
 * Friendly messages for the BountyExtension custom errors a bidder can hit.
 * The deployed contract reverts with these custom errors, but Somnia's RPC
 * surfaces them generically (e.g. "invalid transaction"); decoding against the
 * ABI lets us show the real reason.
 */
const BID_ERROR_MESSAGES: Record<string, string> = {
  AgentNotRegistered:
    "Only registered, active agents can bid. Register your agent in the directory first.",
  AgentMissingSkill:
    "Your agent doesn't have a skill this bounty requires.",
  DeadlinePassed: "This bounty's deadline has already passed.",
  BountyNotOpen: "This bounty is no longer open for bids.",
  BountyNotFound: "This bounty could not be found.",
};

/** Turn a thrown bid error into a human-readable message. */
export function describeBidError(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk(
      (err) => err instanceof ContractFunctionRevertedError,
    );
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name) {
        return BID_ERROR_MESSAGES[name] ?? `Bid rejected on-chain (${name}).`;
      }
    }
    const short = e.shortMessage ?? e.message;
    if (/user rejected|denied|rejected the request/i.test(short)) {
      return "Transaction rejected in your wallet.";
    }
    if (/invalid transaction/i.test(short)) {
      return "The bid was rejected on-chain. Make sure your wallet is a registered agent eligible for this bounty.";
    }
    return short;
  }
  return e instanceof Error ? e.message : String(e);
}

export function usePlaceBid() {
  const ext = bountyExtensionAddress();
  const { writeContractAsync, ...rest } = useWriteContract();
  return {
    ...rest,
    placeBid: async (args: {
      bountyId: bigint;
      proposedFee: bigint;
      proposedDeadlineTs: bigint;
    }) => {
      if (!ext) throw new Error("BountyExtension not deployed");
      return writeContractAsync({
        address: ext,
        abi: bountyExtensionAbi,
        functionName: "bid",
        args: [args.bountyId, args.proposedFee, args.proposedDeadlineTs],
      });
    },
  };
}

export function usePostBounty() {
  const ext = bountyExtensionAddress();
  const { writeContractAsync, ...rest } = useWriteContract();
  return {
    ...rest,
    postBounty: async (args: {
      athlete: Address;
      videoCid: string;
      deadline: bigint;
      requiredSkills: Hex[];
      valueWei: bigint;
    }) => {
      if (!ext) throw new Error("BountyExtension not deployed");
      return writeContractAsync({
        address: ext,
        abi: bountyExtensionAbi,
        functionName: "postBounty",
        args: [args.athlete, args.videoCid, args.deadline, args.requiredSkills],
        value: args.valueWei,
      });
    },
  };
}

export function useAcceptBid() {
  const ext = bountyExtensionAddress();
  const { writeContractAsync, ...rest } = useWriteContract();
  return {
    ...rest,
    accept: async (bountyId: bigint, bidId: bigint) => {
      if (!ext) throw new Error("BountyExtension not deployed");
      return writeContractAsync({
        address: ext,
        abi: bountyExtensionAbi,
        functionName: "accept",
        args: [bountyId, bidId],
      });
    },
  };
}

export function useExpireBounty() {
  const ext = bountyExtensionAddress();
  const { writeContractAsync, ...rest } = useWriteContract();
  return {
    ...rest,
    expire: async (bountyId: bigint) => {
      if (!ext) throw new Error("BountyExtension not deployed");
      return writeContractAsync({
        address: ext,
        abi: bountyExtensionAbi,
        functionName: "expireBounty",
        args: [bountyId],
      });
    },
  };
}

export function useMinBountyFee() {
  const ext = bountyExtensionAddress();
  return useReadContract({
    address: ext ?? undefined,
    abi: bountyExtensionAbi,
    functionName: "minBountyFee",
    query: { enabled: !!ext },
  });
}

export function parseSttToWei(input: string): bigint {
  return parseEther(input.trim() || "0");
}
