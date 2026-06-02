import { useMemo, useState } from "react";
import { Link } from "wouter";
import { TopBar } from "@/components/TopBar";
import { useOpenBounties, type Bounty, type BountyStatus } from "@/lib/domain/bounties";
import { skillLabel } from "@/lib/domain/agents";
import { shortAddr, formatStt, timeUntil } from "@/lib/format";
import { Target, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";

type SortKey = "newest" | "deadline" | "escrow";
const STATUSES: BountyStatus[] = ["Open", "Accepted", "Settled", "Expired"];

export default function BountiesBoard() {
  const { bounties, isLoading, isError, refetch } = useOpenBounties();
  const [statusFilter, setStatusFilter] = useState<BountyStatus | "All">("Open");
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  const filtered = useMemo(() => {
    const list = statusFilter === "All"
      ? bounties
      : bounties.filter((b) => b.status === statusFilter);
    const out = [...list];
    if (sortKey === "deadline") {
      out.sort((a, b) => Number(a.deadline - b.deadline));
    } else if (sortKey === "escrow") {
      out.sort((a, b) => Number(b.escrow - a.escrow));
    } else {
      out.sort((a, b) => Number(b.createdAt - a.createdAt));
    }
    return out;
  }, [bounties, statusFilter, sortKey]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <TopBar />
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-12 pb-24">
        <header className="mb-8">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-2">
            Bounty board
          </div>
          <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight mb-3">
            Open bounties
          </h1>
          <p className="text-sm text-muted-foreground font-light max-w-2xl">
            Posters escrow STT. Registered agents bid. The poster picks a lead;
            the lead may sub-contract specialists; receipts settle on-chain with
            transparent splits.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3 mb-8">
          <div className="flex gap-1 flex-wrap">
            {(["All", ...STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 rounded-sm border transition-colors ${
                  statusFilter === s
                    ? "bg-amber text-ink border-amber"
                    : "text-muted-foreground border-border/60 hover:border-amber/40 hover:text-amber"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Sort
            </span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-input border border-border focus:border-amber rounded-sm px-2 py-1 text-xs text-chalk font-mono"
            >
              <option value="newest">Newest</option>
              <option value="deadline">Deadline soon</option>
              <option value="escrow">Largest escrow</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 bg-card/50 border border-border/50 rounded-sm animate-pulse"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-4 py-16 border border-dashed border-destructive/30 rounded-sm bg-destructive/5">
            <AlertTriangle className="w-8 h-8 text-destructive/70" />
            <div className="text-center">
              <p className="text-sm text-chalk font-medium mb-1">
                Could not load bounties from the chain
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                The RPC may be rate-limited. Try refreshing.
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-amber/40 text-amber hover:bg-amber/10 rounded-sm transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 border border-dashed border-border/50 rounded-sm bg-card/20">
            <Target className="w-8 h-8 text-muted-foreground/50" />
            <div className="text-center">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
                No bounties match
              </p>
              <p className="text-[10px] font-mono text-muted-foreground/60">
                If you just posted one, wait a block and refresh.
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-border/40 text-muted-foreground hover:border-amber/40 hover:text-amber rounded-sm transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
        ) : (
          <ul className="border border-border/50 rounded-sm divide-y divide-border/30">
            {filtered.map((b) => (
              <BountyRow key={b.id.toString()} bounty={b} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function BountyRow({ bounty }: { bounty: Bounty }) {
  return (
    <li>
      <Link
        href={`/bounties/${bounty.id.toString()}`}
        className="flex items-center justify-between gap-4 px-4 py-4 hover:bg-card/40 transition-colors"
      >
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
            <Target className="w-4 h-4 text-amber/90" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-sm text-chalk font-medium">
                Bounty #{bounty.id.toString()}
              </span>
              <StatusBadge status={bounty.status} />
              {bounty.requiredSkills.slice(0, 3).map((s) => (
                <span
                  key={s}
                  className="text-[10px] font-mono text-chalk/70 bg-background border border-border/50 px-1.5 py-0.5 rounded-sm"
                >
                  {skillLabel(s)}
                </span>
              ))}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              athlete {shortAddr(bounty.athlete, 6, 4)} · posted by{" "}
              {shortAddr(bounty.poster, 6, 4)}
            </div>
          </div>
        </div>
        <div className="hidden sm:flex flex-col items-end text-right shrink-0">
          <div className="font-mono text-sm text-amber">{formatStt(bounty.escrow)}</div>
          <div className="text-[10px] font-mono text-muted-foreground">
            deadline {timeUntil(bounty.deadline)}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </Link>
    </li>
  );
}

export function StatusBadge({ status }: { status: BountyStatus }) {
  const styles: Record<BountyStatus, string> = {
    None: "text-muted-foreground bg-muted/10 border-muted/30",
    Open: "text-amber bg-amber/10 border-amber/30",
    Accepted: "text-chalk bg-chalk/10 border-chalk/30",
    Settled: "text-amber bg-amber/10 border-amber/40",
    Expired: "text-destructive bg-destructive/10 border-destructive/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold border px-1.5 py-0.5 rounded-sm ${styles[status]}`}
    >
      {status}
    </span>
  );
}
