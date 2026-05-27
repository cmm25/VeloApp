import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { TopBar } from "@/components/TopBar";
import { AthleteMonogram } from "@/components/AthleteMonogram";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useAthleteDirectory } from "@/lib/domain/athletes";
import { useRemoveRoster } from "@/lib/domain/roster";
import { useTapes, formatTapeDate, formatTapeSize } from "@/lib/domain/tapes";
import { useMyJobs } from "@/hooks/useVeloContracts";
import { useAthleteReceipts } from "@/hooks/useVeloContracts";
import { shortAddr } from "@/lib/format";
import { CompositionTree, type CompositionNode } from "@/components/CompositionTree";
import { ArrowLeft, ChevronRight, Film, Plus, Trash2, LinkIcon } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

/**
 * Per-athlete workspace at /coach/athletes/:address.
 * Shows the athlete's library, the sessions this coach has paid for them,
 * and a quick action to start a new session pre-targeted to this athlete.
 */
export default function AthleteWorkspace({ address: addrParam }: { address: string }) {
  const valid = isAddress(addrParam);
  const athlete = valid ? (addrParam.toLowerCase() as Address) : undefined;
  const { address: coachAddr } = useAccount();
  const { resolve, ensure } = useAthleteDirectory();
  const { jobs } = useMyJobs(coachAddr);
  const { receipts, count } = useAthleteReceipts(athlete);
  const tapesQ = useTapes(athlete);
  const remove = useRemoveRoster();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (athlete) ensure(athlete);
  }, [athlete, ensure]);

  if (!valid || !athlete) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <TopBar />
        <main className="flex-1 max-w-2xl w-full mx-auto p-12 text-center">
          <h1 className="font-serif-display text-3xl text-chalk mb-2">Invalid athlete</h1>
          <Link href="/coach" className="text-amber hover:underline">Back to roster</Link>
        </main>
      </div>
    );
  }

  const profile = resolve(athlete);
  const athleteJobs = jobs.filter((j) => j.athlete.toLowerCase() === athlete);
  const tapes = tapesQ.data ?? [];

  const handleRemove = async () => {
    if (!confirm("Remove this athlete from your roster? Past sessions stay on-chain.")) return;
    try {
      await remove.mutateAsync(athlete);
      toast.success("Removed from roster");
      setLocation("/coach");
    } catch (err) {
      toast.error("Remove failed", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <TopBar />
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 md:p-12 pb-24">
        <Link
          href="/coach"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-chalk transition-colors text-sm mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Roster
        </Link>

        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row md:items-center gap-6 mb-12 border-b border-border/50 pb-8"
        >
          {profile && <AthleteMonogram name={profile.name} size="xl" />}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-2">
              Athlete workspace
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight leading-tight truncate">
                {profile?.name ?? "Athlete"}
              </h1>
              {profile && <VerifiedBadge verified={profile.verified} size="md" />}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground mt-2 truncate">{athlete}</div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => setLocation(`/coach/new?athlete=${athlete}`)}
              className="inline-flex items-center gap-2 bg-amber hover:bg-amber-soft text-ink px-4 py-2 font-bold tracking-wide rounded-sm text-sm"
            >
              <Plus className="w-4 h-4" /> New session
            </button>
            <Link
              href={`/p/${athlete}`}
              className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-amber hover:text-amber-soft border border-amber/40 hover:border-amber px-3 py-2 rounded-sm transition-colors justify-center"
            >
              <LinkIcon className="w-3 h-3" /> Public profile
            </Link>
            <button
              onClick={handleRemove}
              disabled={remove.isPending}
              className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-destructive hover:text-destructive border border-destructive/40 hover:border-destructive/70 px-3 py-2 rounded-sm transition-colors justify-center disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" /> Remove
            </button>
          </div>
        </motion.header>

        <div className="grid md:grid-cols-3 gap-3 mb-10">
          <Tile label="Library tapes" value={tapes.length} />
          <Tile label="Sessions with you" value={athleteJobs.length} />
          <Tile label="On-chain receipts" value={Number(count)} />
        </div>

        <section className="mb-12">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Tape library{tapes.length > 0 ? ` · ${tapes.length}` : ""}
          </h2>
          {tapesQ.isLoading ? (
            <div className="h-24 bg-card/50 border border-border/50 rounded-sm animate-pulse" />
          ) : tapes.length === 0 ? (
            <p className="text-xs text-muted-foreground font-light">
              No tapes yet. The athlete uploads to their own library; you can also upload one on
              their behalf when starting a new session.
            </p>
          ) : (
            <ul className="grid sm:grid-cols-2 gap-3">
              {tapes.map((t) => (
                <li key={t.id} className="p-3 bg-card/40 border border-border/50 rounded-sm flex items-center gap-3">
                  <div className="w-10 h-10 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
                    <Film className="w-4 h-4 text-amber/80" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-chalk truncate">{t.label ?? "Untitled tape"}</div>
                    <div className="text-[10px] font-mono text-muted-foreground truncate">
                      {formatTapeDate(t.createdAt)} · {formatTapeSize(t.sizeBytes)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Sessions with this athlete{athleteJobs.length > 0 ? ` · ${athleteJobs.length}` : ""}
          </h2>
          {athleteJobs.length === 0 ? (
            <div className="border-l-2 border-amber/30 pl-6 py-4 my-4">
              <p className="font-serif-display text-lg text-chalk mb-1">No sessions yet</p>
              <p className="text-muted-foreground font-mono text-[11px] uppercase tracking-widest">
                Open the first one with "New session" above.
              </p>
            </div>
          ) : (
            <ul className="border border-border/50 rounded-sm divide-y divide-border/30">
              {athleteJobs.map((j) => (
                <li key={j.jobId}>
                  <Link
                    href={`/coach/jobs/${j.jobId}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-card/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-chalk font-medium">{j.status}</div>
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        {shortAddr(j.jobId, 6, 4)} · {new Date(Number(j.createdAt) * 1000).toLocaleDateString()}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mt-6">
            Receipts on-chain · {receipts.length} ·{" "}
            <Link href={`/p/${athlete}`} className="text-amber hover:text-amber-soft">View timeline</Link>
          </p>
        </section>

        {receipts.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
              Latest composition
            </h2>
            <CompositionTree
              nodes={
                [
                  {
                    role: "lead",
                    agent: receipts[receipts.length - 1]!.formAgent,
                    label: "Form agent",
                    receiptCid: receipts[receipts.length - 1]!.ipfsCid,
                  },
                  {
                    role: "sub",
                    agent: receipts[receipts.length - 1]!.prescriptionAgent,
                    label: "Prescriber",
                    receiptCid: receipts[receipts.length - 1]!.ipfsCid,
                  },
                ] as CompositionNode[]
              }
            />
          </section>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card/30 border border-border/50 p-4 rounded-sm">
      <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
        {label}
      </div>
      <div className="font-mono text-2xl leading-none text-chalk">{value}</div>
    </div>
  );
}
