import { useMemo } from "react";
import {
  useReadContract,
  useReadContracts,
  useWriteContract,
  usePublicClient,
  useWatchContractEvent,
} from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseEther, type Address, type Hex } from "viem";
import { bountyExtensionAbi } from "@/lib/web3/abis";
import { bountyExtensionAddress } from "@/hooks/useVeloContracts";
import { somniaTestnet } from "@/lib/web3/chain";

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

/** Open bounties + recently-touched ones, derived from BountyPosted logs. */
export function useOpenBounties() {
  const client = usePublicClient({ chainId: somniaTestnet.id });
  const ext = bountyExtensionAddress();
  const idsQ = useQuery({
    queryKey: ["velo:bounty:ids", ext],
    enabled: !!client && !!ext,
    staleTime: 15_000,
    queryFn: async () => {
      const event = bountyExtensionAbi.find(
        (x) => x.type === "event" && x.name === "BountyPosted",
      );
      if (!event) return [] as bigint[];
      const logs = await client!.getLogs({
        address: ext!,
        event: event as never,
        fromBlock: 0n,
        toBlock: "latest",
      });
      return logs.map(
        (l) => (l as unknown as { args: { bountyId: bigint } }).args.bountyId,
      );
    },
  });
  const ids = idsQ.data ?? [];
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
    isLoading: idsQ.isLoading || detailsQ.isLoading,
    refetch: () => {
      idsQ.refetch();
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
  | { kind: "BountyPosted"; blockNumber: bigint; data: { escrow: bigint; deadline: bigint } }
  | {
      kind: "BidPlaced";
      blockNumber: bigint;
      data: { bidId: bigint; agent: Address; proposedFee: bigint };
    }
  | {
      kind: "BidAccepted";
      blockNumber: bigint;
      data: { bidId: bigint; leadAgent: Address; acceptedFee: bigint };
    }
  | { kind: "JobStarted"; blockNumber: bigint; data: { leadAgent: Address; deadline: bigint } }
  | { kind: "SubContracted"; blockNumber: bigint; data: { subAgent: Address } }
  | {
      kind: "Settled";
      blockNumber: bigint;
      data: { totalPaid: bigint; splits: { agent: Address; bps: number }[] };
    }
  | { kind: "BountyExpired"; blockNumber: bigint; data: { refund: bigint } };

/**
 * Watch every BountyExtension event filtered to `id` and merge into a sorted
 * timeline. Returns an empty list while loading.
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
      const out: TimelineEntry[] = [];
      const names = [
        "BountyPosted",
        "BidPlaced",
        "BidAccepted",
        "JobStarted",
        "SubContracted",
        "Settled",
        "BountyExpired",
      ] as const;
      for (const name of names) {
        const event = bountyExtensionAbi.find(
          (x) => x.type === "event" && x.name === name,
        );
        if (!event) continue;
        const logs = await client!.getLogs({
          address: ext!,
          event: event as never,
          args: { bountyId: id } as never,
          fromBlock: 0n,
          toBlock: "latest",
        });
        for (const raw of logs) {
          const l = raw as unknown as { args: Record<string, unknown>; blockNumber: bigint };
          const args = l.args;
          switch (name) {
            case "BountyPosted":
              out.push({
                kind: "BountyPosted",
                blockNumber: l.blockNumber!,
                data: {
                  escrow: args.escrow as bigint,
                  deadline: args.deadline as bigint,
                },
              });
              break;
            case "BidPlaced":
              out.push({
                kind: "BidPlaced",
                blockNumber: l.blockNumber!,
                data: {
                  bidId: args.bidId as bigint,
                  agent: args.agent as Address,
                  proposedFee: args.proposedFee as bigint,
                },
              });
              break;
            case "BidAccepted":
              out.push({
                kind: "BidAccepted",
                blockNumber: l.blockNumber!,
                data: {
                  bidId: args.bidId as bigint,
                  leadAgent: args.leadAgent as Address,
                  acceptedFee: args.acceptedFee as bigint,
                },
              });
              break;
            case "JobStarted":
              out.push({
                kind: "JobStarted",
                blockNumber: l.blockNumber!,
                data: {
                  leadAgent: args.leadAgent as Address,
                  deadline: args.deadline as bigint,
                },
              });
              break;
            case "SubContracted":
              out.push({
                kind: "SubContracted",
                blockNumber: l.blockNumber!,
                data: { subAgent: args.subAgent as Address },
              });
              break;
            case "Settled":
              out.push({
                kind: "Settled",
                blockNumber: l.blockNumber!,
                data: {
                  totalPaid: args.totalPaid as bigint,
                  splits: ((args.splits as unknown[]) ?? []).map((s) => {
                    const x = s as Record<string, unknown>;
                    return {
                      agent: x.agent as Address,
                      bps: Number(x.bps ?? 0),
                    };
                  }),
                },
              });
              break;
            case "BountyExpired":
              out.push({
                kind: "BountyExpired",
                blockNumber: l.blockNumber!,
                data: { refund: args.refund as bigint },
              });
              break;
          }
        }
      }
      out.sort((a, b) => Number(a.blockNumber - b.blockNumber));
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

// ─────────────────── write hooks ───────────────────

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
