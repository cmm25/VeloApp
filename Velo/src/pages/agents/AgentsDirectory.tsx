import { useMemo, useState } from "react";
import { Link } from "wouter";
import type { Hex } from "viem";
import { TopBar } from "@/components/TopBar";
import {
  useRegisteredAgents,
  useReputation,
  skillLabel,
  type AgentRecord,
} from "@/lib/domain/agents";
import { shortAddr, formatStt } from "@/lib/format";
import { Bot, ShieldCheck, ShieldOff, Activity } from "lucide-react";

export default function AgentsDirectory() {
  const { agents, isLoading } = useRegisteredAgents();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSkills = useMemo(() => {
    const set = new Set<string>();
    agents.forEach((a) => a.skills.forEach((s) => set.add(s.toLowerCase())));
    return Array.from(set) as Hex[];
  }, [agents]);

  const filtered = useMemo(() => {
    if (selected.size === 0) return agents;
    return agents.filter((a) =>
      a.skills.some((s) => selected.has(s.toLowerCase())),
    );
  }, [agents, selected]);

  const toggle = (s: Hex) => {
    const next = new Set(selected);
    const key = s.toLowerCase();
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <TopBar />
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-12 pb-24">
        <header className="mb-10">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-2">
            Agent registry
          </div>
          <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight mb-3">
            On-chain agents
          </h1>
          <p className="text-sm text-muted-foreground font-light max-w-2xl">
            Every agent here is registered on the AgentRegistry contract on
            Somnia. Bid on bounties they match; receipts they sign are verifiable
            against the address listed below.
          </p>
        </header>

        {allSkills.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {allSkills.map((s) => {
              const active = selected.has(s.toLowerCase());
              return (
                <button
                  key={s}
                  onClick={() => toggle(s)}
                  className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 rounded-sm border transition-colors ${
                    active
                      ? "bg-amber text-ink border-amber"
                      : "text-muted-foreground border-border/60 hover:border-amber/40 hover:text-amber"
                  }`}
                >
                  {skillLabel(s)}
                </button>
              );
            })}
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground hover:text-chalk px-3 py-1.5"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-40 bg-card/50 border border-border/50 rounded-sm animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((a) => (
              <AgentCard key={a.address} agent={a} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentRecord }) {
  const { stats } = useReputation(agent.address);
  return (
    <Link
      href={`/a/${agent.address}`}
      className="block p-5 bg-card/40 border border-border/50 hover:border-amber/40 rounded-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4 text-amber/90" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-chalk truncate font-medium">
              {agent.name || "Unnamed agent"}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {shortAddr(agent.address, 6, 4)}
            </div>
          </div>
        </div>
        {agent.active ? (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-amber bg-amber/10 border border-amber/30 px-2 py-0.5 rounded-sm">
            <ShieldCheck className="w-3 h-3" /> Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-destructive bg-destructive/10 border border-destructive/30 px-2 py-0.5 rounded-sm">
            <ShieldOff className="w-3 h-3" /> Inactive
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {agent.skills.slice(0, 4).map((s) => (
          <span
            key={s}
            className="text-[10px] font-mono text-chalk/70 bg-background border border-border/50 px-2 py-0.5 rounded-sm"
          >
            {skillLabel(s)}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground mt-4 pt-3 border-t border-border/40">
        <Stat label="Fee" value={formatStt(agent.feeWei)} />
        <Stat
          label="Jobs"
          value={stats ? stats.jobsCompleted.toString() : "—"}
        />
        <Stat
          label="Score"
          value={stats ? stats.rollingScore.toString() : "—"}
        />
      </div>
      {stats && stats.lastActivity > 0n && (
        <div className="text-[10px] font-mono text-muted-foreground mt-2 flex items-center gap-1">
          <Activity className="w-3 h-3 text-amber/70" />
          last {timeUntilPast(stats.lastActivity)}
        </div>
      )}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div>{label}</div>
      <div className="font-mono text-sm text-chalk normal-case tracking-normal font-normal mt-1">
        {value}
      </div>
    </div>
  );
}

function timeUntilPast(ts: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - Number(ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function EmptyState() {
  return (
    <div className="text-center py-20 border border-dashed border-border/50 rounded-sm bg-card/20">
      <div className="w-14 h-14 bg-card border border-border/50 rounded-full flex items-center justify-center mx-auto mb-5">
        <Bot className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        No agents registered yet
      </p>
      <p className="text-xs text-muted-foreground font-light mt-2 max-w-sm mx-auto">
        Operators register their endpoints + skills on the AgentRegistry
        contract. Once they do, they show up here.
      </p>
    </div>
  );
}
