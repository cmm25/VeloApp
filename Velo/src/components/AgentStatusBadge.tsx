import { useReadContract } from "wagmi";
import type { Address } from "viem";
import { deployment } from "@/lib/web3/deployment";
import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

const agentRegistryAbi = [
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/**
 * Live "Active in AgentRegistry" badge — queries the canonical Somnia
 * IAgentRegistry contract bound to this deployment, no proxy in between.
 */
export function AgentStatusBadge({
  agent,
  className,
}: {
  agent: Address;
  className?: string;
}) {
  const registry = deployment?.contracts.agentRegistry;
  const activeQ = useReadContract({
    address: registry,
    abi: agentRegistryAbi,
    functionName: "isActive",
    args: [agent],
    query: { enabled: !!registry, staleTime: 10_000, refetchInterval: 15_000 },
  });
  const registeredQ = useReadContract({
    address: registry,
    abi: agentRegistryAbi,
    functionName: "isRegistered",
    args: [agent],
    query: {
      enabled: !!registry && activeQ.data === false,
      staleTime: 10_000,
      refetchInterval: 15_000,
    },
  });

  const base =
    "inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-sm border";

  if (!registry || activeQ.isLoading) {
    return (
      <span
        className={`${base} border-border/50 bg-card text-muted-foreground ${className ?? ""}`}
        title="Querying AgentRegistry…"
      >
        <ShieldQuestion className="w-2.5 h-2.5" /> Registry
      </span>
    );
  }
  if (activeQ.data === true) {
    return (
      <span
        className={`${base} border-amber/50 bg-amber/15 text-amber ${className ?? ""}`}
        title={`isActive(${agent}) == true on AgentRegistry ${registry}`}
      >
        <ShieldCheck className="w-2.5 h-2.5" /> Registry active
      </span>
    );
  }
  if (registeredQ.data === true) {
    return (
      <span
        className={`${base} border-destructive/50 bg-destructive/10 text-destructive ${className ?? ""}`}
        title="Registered but currently inactive on AgentRegistry"
      >
        <ShieldAlert className="w-2.5 h-2.5" /> De-registered
      </span>
    );
  }
  return (
    <span
      className={`${base} border-border/60 bg-card text-muted-foreground ${className ?? ""}`}
      title="Address not registered on AgentRegistry"
    >
      <ShieldQuestion className="w-2.5 h-2.5" /> Unregistered
    </span>
  );
}
