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

// Tiebreak between two registrations of the same logical agent.
function preferAgent(a: AgentRecord, b: AgentRecord): boolean {
  if (a.active !== b.active) return a.active;
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
    const all: AgentRecord[] = [];
    detailsQ.data.forEach((res, i) => {
      if (res.status === "success") {
        const a = decodeAgent(addresses[i]!, res.result);
        if (a && a.exists) all.push(a);
      }
    });
    // Collapse duplicate registrations of the same logical agent — same name,
    // endpoint and skill set, registered under rotated keys. Including the
    // endpoint avoids merging genuinely distinct agents that only share branding.
    const byIdentity = new Map<string, AgentRecord>();
    for (const a of all) {
      const key = [
        a.name.trim().toLowerCase(),
        a.endpoint.trim().toLowerCase(),
        a.skills.map((s) => s.toLowerCase()).sort().join(","),
      ].join("|");
      const cur = byIdentity.get(key);
      if (!cur || preferAgent(a, cur)) byIdentity.set(key, a);
    }
    return Array.from(byIdentity.values());
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
