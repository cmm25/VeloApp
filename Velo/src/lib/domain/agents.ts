import { useMemo } from "react";
import { useReadContract, useReadContracts, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import type { Address, Hex, AbiEvent } from "viem";
import { agentRegistryAbi, reputationAbi } from "@/lib/web3/abis";
import { getRecentLogs } from "@/lib/web3/logs";
import {
  agentRegistryAddress,
  reputationAddress,
} from "@/hooks/useVeloContracts";
import { somniaTestnet } from "@/lib/web3/chain";

export type AgentRecord = {
  address: Address;
  name: string;
  endpoint: string;
  skills: Hex[];
  feeWei: bigint;
  active: boolean;
  exists: boolean;
  registeredAt: bigint;
  updatedAt: bigint;
};

export type ReputationStats = {
  jobsCompleted: bigint;
  totalEarnedWei: bigint;
  lastActivity: bigint;
  rollingScore: bigint;
};

function decodeAgent(addr: Address, raw: unknown): AgentRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    address: addr,
    name: (r.name as string) ?? "",
    endpoint: (r.endpoint as string) ?? "",
    skills: ((r.skills as Hex[]) ?? []) as Hex[],
    feeWei: (r.feeWei as bigint) ?? 0n,
    active: Boolean(r.active),
    exists: Boolean(r.exists),
    registeredAt: (r.registeredAt as bigint) ?? 0n,
    updatedAt: (r.updatedAt as bigint) ?? 0n,
  };
}

/** List every registered agent in the on-chain registry. */
export function useRegisteredAgents() {
  const reg = agentRegistryAddress();
  const listQ = useReadContract({
    address: reg ?? undefined,
    abi: agentRegistryAbi,
    functionName: "listAgents",
    query: { enabled: !!reg },
  });
  const addresses = (listQ.data as Address[] | undefined) ?? [];
  const detailsQ = useReadContracts({
    contracts: addresses.map((a) => ({
      address: reg!,
      abi: agentRegistryAbi,
      functionName: "getAgent" as const,
      args: [a] as const,
    })),
    query: { enabled: !!reg && addresses.length > 0 },
  });
  const agents = useMemo<AgentRecord[]>(() => {
    if (!detailsQ.data) return [];
    const out: AgentRecord[] = [];
    detailsQ.data.forEach((res, i) => {
      if (res.status === "success") {
        const a = decodeAgent(addresses[i]!, res.result);
        if (a && a.exists) out.push(a);
      }
    });
    return out;
  }, [detailsQ.data, addresses]);
  return {
    agents,
    isLoading: listQ.isLoading || detailsQ.isLoading,
    refetch: () => {
      listQ.refetch();
      detailsQ.refetch();
    },
  };
}

export function useAgent(address?: Address) {
  const reg = agentRegistryAddress();
  const enabled = !!reg && !!address;
  const q = useReadContract({
    address: reg ?? undefined,
    abi: agentRegistryAbi,
    functionName: "getAgent",
    args: address ? [address] : undefined,
    query: { enabled },
  });
  return {
    ...q,
    data: q.data && address ? decodeAgent(address, q.data) : null,
  };
}

export function useReputation(address?: Address) {
  const rep = reputationAddress();
  const enabled = !!rep && !!address;
  const q = useReadContract({
    address: rep ?? undefined,
    abi: reputationAbi,
    functionName: "statsOf",
    args: address ? [address] : undefined,
    query: { enabled, retry: false },
  });
  const stats = useMemo<ReputationStats | null>(() => {
    if (!q.data || typeof q.data !== "object") return null;
    const r = q.data as Record<string, unknown>;
    return {
      jobsCompleted: (r.jobsCompleted as bigint) ?? 0n,
      totalEarnedWei: (r.totalEarnedWei as bigint) ?? 0n,
      lastActivity: (r.lastActivity as bigint) ?? 0n,
      rollingScore: (r.rollingScore as bigint) ?? 0n,
    };
  }, [q.data]);
  return { ...q, stats };
}

/**
 * Recent ReputationCredited blocks for `address`, used to render a sparkline
 * of "jobs per week".
 */
export function useAgentActivity(address?: Address) {
  const client = usePublicClient({ chainId: somniaTestnet.id });
  const rep = reputationAddress();
  return useQuery({
    queryKey: ["velo:agent-activity", rep, address],
    enabled: !!client && !!rep && !!address,
    staleTime: 30_000,
    queryFn: async () => {
      const event = reputationAbi.find(
        (x) => x.type === "event" && x.name === "ReputationCredited",
      );
      if (!event) return [] as { blockNumber: bigint; ts: number }[];
      // Somnia caps `eth_getLogs` at 1000-block windows, so a from-genesis scan
      // is impossible. Scan a bounded recent window instead — this strip only
      // visualizes *recent* reputation activity.
      const logs = (await getRecentLogs(client!, {
        address: rep!,
        event: event as AbiEvent,
        args: { agent: address },
      })) as Array<{ blockNumber: bigint }>;
      const out: { blockNumber: bigint; ts: number }[] = [];
      for (const raw of logs) {
        const l = raw as unknown as { blockNumber: bigint };
        try {
          const blk = await client!.getBlock({ blockNumber: l.blockNumber });
          out.push({ blockNumber: l.blockNumber, ts: Number(blk.timestamp) });
        } catch {
          /* skip */
        }
      }
      return out.sort((a, b) => a.ts - b.ts);
    },
  });
}

/** Short, human label for an agent's skill. Skills are bytes32 keccak labels. */
const KNOWN_SKILLS: Record<string, string> = {};

export function registerSkillLabel(skill: Hex, label: string) {
  KNOWN_SKILLS[skill.toLowerCase()] = label;
}

export function skillLabel(skill: Hex): string {
  return KNOWN_SKILLS[skill.toLowerCase()] ?? `${skill.slice(0, 10)}…`;
}
