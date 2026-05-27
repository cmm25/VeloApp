import { Link } from "wouter";
import { isAddress, type Address } from "viem";
import { TopBar } from "@/components/TopBar";
import {
  useAgent,
  useReputation,
  useAgentActivity,
  skillLabel,
} from "@/lib/domain/agents";
import { shortAddr, formatStt } from "@/lib/format";
import {
  ArrowLeft,
  Bot,
  ShieldCheck,
  ShieldOff,
  ExternalLink,
  Activity,
} from "lucide-react";

export default function AgentProfile({ address: addrParam }: { address: string }) {
  const valid = isAddress(addrParam);
  const address = valid ? (addrParam as Address) : undefined;
  const { data: agent, isLoading } = useAgent(address);
  const { stats } = useReputation(address);
  const activityQ = useAgentActivity(address);

  if (!valid) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <TopBar />
        <main className="flex-1 max-w-2xl w-full mx-auto p-12 text-center">
          <h1 className="font-serif-display text-3xl text-chalk mb-2">
            Invalid agent link
          </h1>
          <Link href="/agents" className="text-amber hover:underline">
            Back to directory
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <TopBar />
      <main className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-12 pb-24">
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-chalk transition-colors text-sm mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Agents
        </Link>

        <header className="flex flex-col md:flex-row md:items-center gap-6 mb-12 border-b border-border/50 pb-10">
          <div className="w-16 h-16 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
            <Bot className="w-7 h-7 text-amber" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-2">
              Agent
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight leading-tight">
                {agent?.name || (isLoading ? "Loading…" : "Unknown agent")}
              </h1>
              {agent &&
                (agent.active ? (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-amber bg-amber/10 border border-amber/30 px-2 py-0.5 rounded-sm">
                    <ShieldCheck className="w-3 h-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-destructive bg-destructive/10 border border-destructive/30 px-2 py-0.5 rounded-sm">
                    <ShieldOff className="w-3 h-3" /> Inactive
                  </span>
                ))}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground mt-2 truncate">
              {address}
            </div>
          </div>
        </header>

        <div className="grid sm:grid-cols-4 gap-3 mb-10">
          <Stat label="Fee" value={agent ? formatStt(agent.feeWei) : "—"} />
          <Stat
            label="Jobs"
            value={stats ? stats.jobsCompleted.toString() : "—"}
          />
          <Stat
            label="Score"
            value={stats ? stats.rollingScore.toString() : "—"}
          />
          <Stat
            label="Earned"
            value={stats ? formatStt(stats.totalEarnedWei) : "—"}
          />
        </div>

        {agent && agent.skills.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Skills
            </h2>
            <div className="flex flex-wrap gap-2">
              {agent.skills.map((s) => (
                <span
                  key={s}
                  className="text-[11px] font-mono text-chalk/80 bg-card border border-border/50 px-2.5 py-1 rounded-sm"
                >
                  {skillLabel(s)}
                </span>
              ))}
            </div>
          </section>
        )}

        {agent?.endpoint && (
          <section className="mb-10">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Endpoint
            </h2>
            <a
              href={agent.endpoint}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 font-mono text-xs text-amber hover:text-amber-soft break-all"
            >
              {agent.endpoint}
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </section>
        )}

        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-amber/70" /> Jobs per week
          </h2>
          <ActivitySparkline data={activityQ.data ?? []} />
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card/40 border border-border/50 px-4 py-3 rounded-sm">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        {label}
      </div>
      <div className="font-mono text-chalk text-base">{value}</div>
    </div>
  );
}

function ActivitySparkline({ data }: { data: { ts: number }[] }) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground font-light">
        No reputation events yet.
      </p>
    );
  }
  const weekly = bucketWeekly(data);
  const max = Math.max(1, ...weekly.map((w) => w.count));
  const w = 600;
  const h = 80;
  const step = weekly.length > 1 ? w / (weekly.length - 1) : w;
  const points = weekly
    .map((wk, i) => {
      const x = i * step;
      const y = h - (wk.count / max) * (h - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="bg-card/40 border border-border/50 rounded-sm p-4">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-20"
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          stroke="hsl(var(--amber))"
          strokeWidth="1.5"
        />
      </svg>
      <div className="text-[10px] font-mono text-muted-foreground mt-2">
        {weekly.length} weeks · peak {max} job{max === 1 ? "" : "s"} / week
      </div>
    </div>
  );
}

function bucketWeekly(data: { ts: number }[]): { weekStart: number; count: number }[] {
  if (data.length === 0) return [];
  const week = 7 * 86400;
  const first = Math.floor(data[0]!.ts / week) * week;
  const last = Math.floor(Date.now() / 1000 / week) * week;
  const buckets: { weekStart: number; count: number }[] = [];
  for (let t = first; t <= last; t += week) {
    buckets.push({ weekStart: t, count: 0 });
  }
  for (const d of data) {
    const idx = Math.floor((d.ts - first) / week);
    if (idx >= 0 && idx < buckets.length) buckets[idx]!.count += 1;
  }
  return buckets;
}
