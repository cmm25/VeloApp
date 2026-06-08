import { useMemo } from "react";
import { useReadContract, useReadContracts, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { keccak256, toBytes, type Address, type Hex, type AbiEvent } from "viem";
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

// Pick the canonical agent between two registrations of the same role: higher
// on-chain reputation wins, then the most recently registered (rotated) key.
function preferAgent(
  a: AgentRecord,
  aScore: bigint,
  b: AgentRecord,
  bScore: bigint,
): boolean {
  if (aScore !== bScore) return aScore > bScore;
  return a.registeredAt > b.registeredAt;
}

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
  const rep = reputationAddress();
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
  // Only active, existing agents are eligible for the directory.
  const activeRecords = useMemo<AgentRecord[]>(() => {
    if (!detailsQ.data) return [];
    const out: AgentRecord[] = [];
    detailsQ.data.forEach((res, i) => {
      if (res.status === "success") {
        const a = decodeAgent(addresses[i]!, res.result);
        if (a && a.exists && a.active) out.push(a);
      }
    });
    return out;
  }, [detailsQ.data, addresses]);
  // Reputation for the active agents — used to pick the canonical one when the
  // same role was registered under several (rotated) keys.
  const repQ = useReadContracts({
    contracts: activeRecords.map((a) => ({
      address: rep!,
      abi: reputationAbi,
      functionName: "statsOf" as const,
      args: [a.address] as const,
    })),
    query: { enabled: !!rep && activeRecords.length > 0 },
  });
  const agents = useMemo<AgentRecord[]>(() => {
    const scoreOf = (i: number): bigint => {
      const r = repQ.data?.[i];
      if (r && r.status === "success" && r.result && typeof r.result === "object") {
        return ((r.result as Record<string, unknown>).rollingScore as bigint) ?? 0n;
      }
      return 0n;
    };
    // Dedupe by role (the agent's skill set): keep one agent per role, preferring
    // the highest on-chain reputation, then the most recently registered key.
    const byRole = new Map<string, { rec: AgentRecord; score: bigint }>();
    activeRecords.forEach((a, i) => {
      const key = a.skills.map((s) => s.toLowerCase()).sort().join(",");
      const score = scoreOf(i);
      const cur = byRole.get(key);
      if (!cur || preferAgent(a, score, cur.rec, cur.score)) {
        byRole.set(key, { rec: a, score });
      }
    });
    return Array.from(byRole.values()).map((v) => v.rec);
  }, [activeRecords, repQ.data]);
  return {
    agents,
    isLoading: listQ.isLoading || detailsQ.isLoading || repQ.isLoading,
    refetch: () => {
      listQ.refetch();
      detailsQ.refetch();
      repQ.refetch();
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

/**
 * Short, human labels for an agent's skills. On-chain a skill is the
 * `keccak256(utf8Bytes(name))` of a canonical string (see the agent registry +
 * `velo-agents` registration), so the raw value is an opaque bytes32 hash. We
 * keep a catalog of the known canonical names, hash each one the same way the
 * contracts do, and map the resulting hash back to a friendly label.
 */
const SKILL_NAMES: Record<string, string> = {
  "vision.pose": "Pose & Form Vision",
  "vision.serve": "Serve Vision Model",
  "coaching.tactics": "Coaching Tactics",
  "coaching.drills": "Coaching Drills",
  "velo.v1": "Velo v1",
};

const KNOWN_SKILLS: Record<string, string> = {};

// Skill hashes that identify a video-analysis ("vision.*") model. These are the
// only skills a coach can pick from when choosing which model analyzes a job.
const VISION_SKILLS = new Set<string>();

/** Register a readable label for a skill given its on-chain bytes32 hash. */
export function registerSkillLabel(skill: Hex, label: string) {
  KNOWN_SKILLS[skill.toLowerCase()] = label;
}

/** Register a readable label for a skill given its canonical name. */
export function registerSkillName(name: string, label = name) {
  registerSkillLabel(keccak256(toBytes(name)), label);
}

for (const [name, label] of Object.entries(SKILL_NAMES)) {
  registerSkillName(name, label);
  if (name.startsWith("vision.")) {
    VISION_SKILLS.add(keccak256(toBytes(name)).toLowerCase());
  }
}

/** True when the skill hash maps to a known, human-readable label. */
export function isKnownSkill(skill: Hex): boolean {
  return skill.toLowerCase() in KNOWN_SKILLS;
}

/** True when the skill is a video-analysis ("vision.*") model skill. */
export function isVisionSkill(skill: Hex): boolean {
  return VISION_SKILLS.has(skill.toLowerCase());
}

/**
 * The catalog of known video-analysis model skills (every `vision.*` entry in
 * SKILL_NAMES, e.g. the default Pose & Form model and the Serve model). The
 * direct-hire picker offers these so a coach can always choose a model, even
 * before a given analysis agent is enumerated in the on-chain registry.
 */
export function catalogVisionSkills(): Hex[] {
  return Array.from(VISION_SKILLS) as Hex[];
}

export function skillLabel(skill: Hex): string {
  return KNOWN_SKILLS[skill.toLowerCase()] ?? `${skill.slice(0, 10)}…`;
}
