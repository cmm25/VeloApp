import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import { veloOrchestratorAbi } from "@/lib/web3/abis";
import { somniaTestnet } from "@/lib/web3/chain";
import { orchestratorAddress } from "@/hooks/useVeloContracts";
import { shortAddr } from "@/lib/format";
import { Activity, Zap } from "lucide-react";

type EventName =
  | "JobRequested"
  | "FormReceiptSubmitted"
  | "PrescriptionSubmitted"
  | "JobCancelled"
  | "AgentWithdrawn";

type Tick = {
  id: string;
  event: EventName;
  jobId?: Hex;
  agent?: Address;
  amount?: bigint;
  blockNumber: bigint;
  at: number;
};

const LABELS: Record<EventName, string> = {
  JobRequested: "JobRequested",
  FormReceiptSubmitted: "FormReceipt",
  PrescriptionSubmitted: "Prescription",
  JobCancelled: "JobCancelled",
  AgentWithdrawn: "AgentWithdrawn",
};

const MAX_TICKS = 8;

/**
 * Live tape of orchestrator events — proves the AI agent loop runs on
 * Somnia in real time. No polling; uses viem's watchContractEvent.
 */
export function AgentActivityStrip() {
  const orch = orchestratorAddress();
  const client = usePublicClient({ chainId: somniaTestnet.id });
  const [ticks, setTicks] = useState<Tick[]>([]);

  useEffect(() => {
    if (!orch || !client) return;
    const push = (t: Omit<Tick, "id" | "at">) => {
      const key = `${t.event}:${t.jobId ?? t.agent ?? ""}:${t.blockNumber}`;
      setTicks((prev) =>
        [{ ...t, id: key, at: Date.now() }, ...prev.filter((p) => p.id !== key)].slice(0, MAX_TICKS),
      );
    };

    const subs = (
      [
        "JobRequested",
        "FormReceiptSubmitted",
        "PrescriptionSubmitted",
        "JobCancelled",
        "AgentWithdrawn",
      ] as const
    ).map((eventName) =>
      client.watchContractEvent({
        address: orch,
        abi: veloOrchestratorAbi,
        eventName,
        onLogs: (logs) => {
          for (const log of logs) {
            const a = log.args as { jobId?: Hex; agent?: Address; amount?: bigint };
            push({
              event: eventName,
              jobId: a.jobId,
              agent: a.agent,
              amount: a.amount,
              blockNumber: log.blockNumber ?? 0n,
            });
          }
        },
      }),
    );
    return () => subs.forEach((u) => u());
  }, [orch, client]);

  if (!orch) return null;

  return (
    <div className="mb-8 border border-border/50 bg-card/30 rounded-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-amber" /> Live agent loop · Somnia
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {shortAddr(orch, 6, 4)}
        </div>
      </div>
      {ticks.length === 0 ? (
        <div className="px-3 py-3 text-[11px] font-mono text-muted-foreground flex items-center gap-2">
          <Zap className="w-3 h-3 text-amber/70 animate-pulse" />
          Listening for orchestrator events…
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {ticks.map((t) => (
            <li
              key={t.id}
              className="px-3 py-1.5 grid grid-cols-[8rem_1fr_auto] gap-3 items-center text-[11px] font-mono"
            >
              <span className="text-amber truncate">{LABELS[t.event]}</span>
              <span className="text-chalk/80 truncate">
                {t.jobId ? <>job {shortAddr(t.jobId, 6, 4)}</> : <>—</>}
                {t.agent && (
                  <span className="text-muted-foreground">
                    {" · "}agent {shortAddr(t.agent, 6, 4)}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">blk {t.blockNumber.toString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
