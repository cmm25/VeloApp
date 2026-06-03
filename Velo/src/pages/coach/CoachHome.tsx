import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { Link, useLocation } from "wouter";
import {
  useJobsByIds,
  useAthletesReceiptJobIds,
  useCancelExpired,
  orchestratorAddress,
  type Job,
  type JobStatus,
} from "@/hooks/useVeloContracts";
import { useRecentJobs } from "@/lib/domain/recentJobs";
import { TopBar } from "@/components/TopBar";
import { AgentActivityStrip } from "@/components/AgentActivityStrip";
import { IndexerSourceBadge } from "@/components/IndexerSourceBadge";
import { AthleteMonogram } from "@/components/AthleteMonogram";
import { somniaTestnet } from "@/lib/web3/chain";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { useAthleteDirectory } from "@/lib/domain/athletes";
import {
  useCoachRoster,
  useCoachPendingRoster,
  useAddRosterByAddress,
  useRemoveRoster,
  type RosterEntry,
} from "@/lib/domain/roster";
import { shortAddr, formatStt, timeUntil } from "@/lib/format";
import { veloOrchestratorAbi } from "@/lib/web3/abis";
import {
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Activity,
  AlertTriangle,
  X,
  UserPlus,
  ChevronDown,
  History,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    Completed: {
      label: "Completed",
      cls: "text-amber bg-amber/10 border-amber/30",
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    Cancelled: {
      label: "Cancelled",
      cls: "text-muted-foreground bg-card border-border/50",
      icon: <XCircle className="w-3 h-3" />,
    },
    FormSubmitted: {
      label: "Form ready",
      cls: "text-amber bg-amber/10 border-amber/30",
      icon: <Activity className="w-3 h-3" />,
    },
    Requested: {
      label: "In progress",
      cls: "text-chalk/80 bg-card border-border/50",
      icon: <Clock className="w-3 h-3" />,
    },
  };
  const m = map[status] ?? map.Requested;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] uppercase tracking-wider font-bold ${m.cls}`}
    >
      {m.icon} {m.label}
    </span>
  );
}

function DeadlineCell({ deadline, status }: { deadline: bigint; status: string }) {
  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = Number(deadline) - now;
  const expired = secondsLeft <= 0;
  const settled = status === "Completed" || status === "Cancelled";

  if (settled) {
    return <span className="text-chalk/40 font-mono text-xs">—</span>;
  }
  if (expired) {
    return (
      <span className="inline-flex items-center gap-1 text-destructive font-mono text-xs">
        <AlertTriangle className="w-3 h-3" /> Expired
      </span>
    );
  }
  const hours = Math.floor(secondsLeft / 3600);
  const mins = Math.floor((secondsLeft % 3600) / 60);
  const tone = hours < 2 ? "text-amber" : "text-chalk/80";
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs ${tone}`}>
      <Clock className="w-3 h-3" />
      {hours > 0 ? `${hours}h ${mins}m` : `${mins}m`}
    </span>
  );
}

export default function CoachHome() {
  const { address } = useAccount();
  const [, setLocation] = useLocation();
  const { writeContractAsync, isPending: cancelling } = useCancelExpired();
  const publicClient = usePublicClient({ chainId: somniaTestnet.id });
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const { resolve, ensure } = useAthleteDirectory();

  const rosterQ = useCoachRoster(!!address);
  const pendingRosterQ = useCoachPendingRoster(!!address);
  const removeRoster = useRemoveRoster();
  const addByAddress = useAddRosterByAddress();
  const roster: RosterEntry[] = rosterQ.data ?? [];
  const pendingRoster: RosterEntry[] = pendingRosterQ.data ?? [];

  // Sessions are reconstructed WITHOUT any event-log scan: Somnia caps
  // `eth_getLogs` at 1000 blocks and jobIds are content-hashed (no counter to
  // enumerate), so a from-genesis `JobRequested` scan is impossible. Instead we
  // gather candidate jobIds from two scan-free sources — the coach's
  // locally-remembered recent jobs and every jobId attached to a roster
  // athlete's SBT (each completed session appends a ReceiptRef) — then re-read
  // each on-chain via `getJob` and keep the ones where this wallet is the coach.
  const { recent } = useRecentJobs(address);
  const recentIds = useMemo(() => recent.map((r) => r.jobId), [recent]);
  const rosterAthletes = useMemo(
    () => roster.map((r) => r.athleteAddress as `0x${string}`),
    [roster],
  );
  const { jobIds: receiptJobIds } = useAthletesReceiptJobIds(rosterAthletes);
  const knownJobIds = useMemo(() => {
    const seen = new Set<string>();
    const out: `0x${string}`[] = [];
    [...recentIds, ...receiptJobIds].forEach((id) => {
      const k = id.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(id);
      }
    });
    return out;
  }, [recentIds, receiptJobIds]);
  const { jobs: knownJobs, isLoading, refetch } = useJobsByIds(knownJobIds);
  const jobs = useMemo<Job[]>(
    () =>
      address
        ? knownJobs
            .filter((j) => j.coach.toLowerCase() === address.toLowerCase())
            .sort((a, b) => Number(b.createdAt - a.createdAt))
        : [],
    [knownJobs, address],
  );
  const [addOpen, setAddOpen] = useState(false);
  const [addAddr, setAddAddr] = useState("");
  const [addLabel, setAddLabel] = useState("");

  // Seed unknown athletes (from jobs + roster) into the directory.
  useEffect(() => {
    jobs.forEach((j) => ensure(j.athlete));
    roster.forEach((r) => ensure(r.athleteAddress as `0x${string}`));
  }, [jobs, roster, ensure]);

  const stats = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return {
      total: jobs.length,
      active: jobs.filter(
        (j) =>
          (j.status === "Requested" || j.status === "FormSubmitted") && Number(j.deadline) > now,
      ).length,
      expired: jobs.filter(
        (j) =>
          (j.status === "Requested" || j.status === "FormSubmitted") && Number(j.deadline) <= now,
      ).length,
      completed: jobs.filter((j) => j.status === "Completed").length,
    };
  }, [jobs]);

  // Authoritative on-chain status by jobId across every known job (used to tell
  // whether a locally-remembered recent job has already settled).
  const statusById = useMemo(() => {
    const m = new Map<string, Job>();
    knownJobs.forEach((j) => m.set(j.jobId.toLowerCase(), j));
    return m;
  }, [knownJobs]);

  // Active = in-progress sessions worth resuming. Union of on-chain in-progress
  // jobs and locally-remembered recent jobs, de-duped by jobId.
  type ActiveEntry = {
    jobId: `0x${string}`;
    athlete: `0x${string}`;
    status: JobStatus;
    createdAt: number; // ms
  };
  const activeJobs = useMemo<ActiveEntry[]>(() => {
    const map = new Map<string, ActiveEntry>();
    jobs.forEach((j) => {
      if (j.status === "Requested" || j.status === "FormSubmitted") {
        map.set(j.jobId.toLowerCase(), {
          jobId: j.jobId,
          athlete: j.athlete,
          status: j.status,
          createdAt: Number(j.createdAt) * 1000,
        });
      }
    });
    recent.forEach((r) => {
      const key = r.jobId.toLowerCase();
      const chain = statusById.get(key);
      // Settled jobs are no longer "active" — they live in All sessions below.
      if (chain && (chain.status === "Completed" || chain.status === "Cancelled")) return;
      if (!map.has(key)) {
        map.set(key, {
          jobId: r.jobId,
          athlete: chain?.athlete ?? r.athlete,
          status: chain?.status ?? "Requested",
          createdAt: r.createdAt,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  }, [jobs, recent, statusById]);

  // Completed sessions — shown in a dedicated Past Sessions section.
  const completedJobs = useMemo(
    () => jobs.filter((j) => j.status === "Completed").sort((a, b) => Number(b.createdAt - a.createdAt)),
    [jobs],
  );

  // Completed/cancelled recent jobs are intentionally NOT pruned from the local
  // store: they're filtered out of "Active sessions" via `statusById` above and
  // they reappear as Past sessions from the SBT-derived list, so keeping them
  // around does no harm and survives a window where the SBT read is still
  // loading.

  const handleQuickCancel = async (jobId: `0x${string}`, fee: bigint) => {
    const orch = orchestratorAddress();
    if (!orch) {
      toast.error("Contract not deployed");
      return;
    }
    setCancellingId(jobId);
    try {
      const t0 = performance.now();
      const hash = await writeContractAsync({
        address: orch,
        abi: veloOrchestratorAbi,
        functionName: "cancelExpired",
        args: [jobId],
      });
      toast.info("Cancel tx submitted", {
        description: `${hash.slice(0, 10)}…${hash.slice(-6)} · awaiting Somnia inclusion`,
      });
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
        const ms = Math.round(performance.now() - t0);
        toast.success(`Refund included in ${ms} ms`, {
          description: `${formatStt(fee)} returned · block ${receipt.blockNumber.toString()}`,
        });
      }
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Cancel failed", { description: msg });
    } finally {
      setCancellingId(null);
    }
  };

  const handleAddByAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const a = addAddr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      toast.error("Enter a valid 0x address");
      return;
    }
    try {
      await addByAddress.mutateAsync({
        athleteAddress: a,
        label: addLabel.trim() || undefined,
      });
      toast.success("Roster request sent", {
        description: "The athlete will see it on their dashboard.",
      });
      setAddAddr("");
      setAddLabel("");
      setAddOpen(false);
      pendingRosterQ.refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        msg === "already_on_roster" ? "Already on your roster" : "Add failed",
        msg !== "already_on_roster" ? { description: msg } : undefined,
      );
    }
  };

  const handleCancelPending = async (athleteAddress: string) => {
    if (!confirm("Cancel this pending roster request?")) return;
    try {
      await removeRoster.mutateAsync(athleteAddress);
      toast.success("Request cancelled");
      pendingRosterQ.refetch();
    } catch (err) {
      toast.error("Cancel failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-amber/30 selection:text-amber">
      <TopBar />

      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div className="space-y-2">
            <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight">
              Roster
            </h1>
            <IndexerSourceBadge source="rpc" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setAddOpen((v) => !v)}
              className="inline-flex items-center gap-2 bg-card hover:bg-border/40 border border-border/60 text-chalk px-4 py-2.5 font-bold tracking-wide rounded-sm text-sm"
              title="Send a roster request to an existing wallet"
            >
              <UserPlus className="w-4 h-4" /> Add by address
            </button>
            <button
              onClick={() => setLocation("/coach/new")}
              className="inline-flex items-center gap-2 bg-amber hover:bg-amber-soft text-ink px-6 py-2.5 font-bold tracking-wide rounded-sm transition-all shadow-[0_0_20px_rgba(245,177,75,0.15)]"
            >
              <Plus className="w-4 h-4" />
              New session
            </button>
          </div>
        </div>

        {/* Inline add-by-address form */}
        {addOpen && (
          <motion.form
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleAddByAddress}
            className="mb-6 p-4 bg-card/30 border border-border/50 rounded-sm grid md:grid-cols-[2fr_1.2fr_auto] gap-2"
          >
            <input
              type="text"
              value={addAddr}
              onChange={(e) => setAddAddr(e.target.value)}
              placeholder="0x… athlete wallet address"
              autoFocus
              className="bg-input border border-border/60 focus:border-amber/60 focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk text-sm font-mono"
            />
            <input
              type="text"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              placeholder="Optional label (private to you)"
              maxLength={80}
              className="bg-input border border-border/60 focus:border-amber/60 focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk text-sm"
            />
            <button
              type="submit"
              disabled={addByAddress.isPending || !addAddr.trim()}
              className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-soft disabled:opacity-60 text-ink px-4 py-2 font-bold tracking-wide rounded-sm text-sm"
            >
              Send request
            </button>
            <p className="md:col-span-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              The athlete must accept on their dashboard before the link is active.
            </p>
          </motion.form>
        )}

        {/* Roster grid */}
        <section className="mb-10">
          {rosterQ.isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-card/50 border border-border/50 rounded-sm animate-pulse" />
              ))}
            </div>
          ) : roster.length === 0 ? (
            <div className="border border-dashed border-border/50 bg-card/20 rounded-sm p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div>
                <div className="font-serif-display text-2xl text-chalk mb-1">
                  Build your roster
                </div>
                <p className="text-sm text-muted-foreground font-light max-w-sm">
                  Add an athlete by their wallet address — they'll accept on their dashboard and start owning their record.
                </p>
              </div>
              <button
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-2 bg-amber hover:bg-amber-soft text-ink px-4 py-2.5 font-bold tracking-wide rounded-sm shrink-0"
              >
                <UserPlus className="w-4 h-4" /> Add first athlete
              </button>
            </div>
          ) : (
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {roster.map((r) => {
                const profile = resolve(r.athleteAddress as `0x${string}`);
                const displayName = r.athleteName ?? r.label ?? profile?.name ?? `Athlete ${r.athleteAddress.slice(2, 6)}`;
                const sessionCount = jobs.filter(
                  (j) => j.athlete.toLowerCase() === r.athleteAddress.toLowerCase(),
                ).length;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/coach/athletes/${r.athleteAddress}`}
                      className="group flex flex-col justify-between h-full p-5 bg-card/40 hover:bg-card border border-border/50 hover:border-amber/40 rounded-sm transition-all gap-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <AthleteMonogram name={displayName} size="lg" />
                        {sessionCount > 0 && (
                          <span className="text-[10px] font-mono text-muted-foreground bg-card border border-border/60 px-2 py-0.5 rounded-sm shrink-0">
                            {sessionCount} session{sessionCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-base text-chalk font-medium truncate leading-tight">
                            {displayName}
                          </span>
                          {profile && <VerifiedBadge verified={profile.verified} />}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground truncate mb-3">
                          {r.athleteAddress}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber/70 group-hover:text-amber transition-colors">
                          Open workspace <ChevronRight className="w-3 h-3" />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
              <li>
                <button
                  onClick={() => setAddOpen(true)}
                  className="w-full h-full min-h-[8rem] flex flex-col items-center justify-center gap-2 p-5 bg-card/20 hover:bg-card/40 border border-dashed border-border/50 hover:border-amber/50 rounded-sm transition-colors text-muted-foreground hover:text-amber"
                >
                  <UserPlus className="w-5 h-5" />
                  <span className="text-[11px] uppercase tracking-widest font-bold">Add athlete</span>
                </button>
              </li>
            </ul>
          )}
        </section>

        {/* Pending roster requests (manual adds awaiting athlete acceptance) */}
        {pendingRoster.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Awaiting athlete acceptance · {pendingRoster.length}
            </h2>
            <ul className="border border-border/50 rounded-sm divide-y divide-border/30">
              {pendingRoster.map((r) => {
                const label = r.athleteName ?? r.label ?? `Athlete ${r.athleteAddress.slice(2, 6)}`;
                return (
                  <li key={r.id} className="flex items-center gap-4 px-4 py-3">
                    <UserPlus className="w-4 h-4 text-amber/70 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-chalk truncate">{label}</div>
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        {shortAddr(r.athleteAddress, 6, 4)} · sent{" "}
                        {new Date(r.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleCancelPending(r.athleteAddress)}
                      disabled={removeRoster.isPending}
                      className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground hover:text-destructive px-2 py-1 border border-border/50 hover:border-destructive/40 rounded-sm transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <AgentActivityStrip />

        {/* Active sessions — resume in-progress work, surfaced instantly from a
            local record so a just-submitted job is reachable before the indexer
            catches up. */}
        {activeJobs.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
              <Activity className="w-3 h-3 text-amber" />
              Active sessions · {activeJobs.length}
            </h2>
            <ul className="grid sm:grid-cols-2 gap-3">
              {activeJobs.map((a) => {
                const athlete = resolve(a.athlete);
                const athleteName = athlete?.name ?? `Athlete ${a.athlete.slice(2, 6)}`;
                return (
                  <li key={a.jobId}>
                    <Link
                      href={`/coach/jobs/${a.jobId}`}
                      className="flex items-center gap-3 px-4 py-3 bg-card/40 hover:bg-card border border-border/50 hover:border-amber/40 rounded-sm transition-colors"
                    >
                      <AthleteMonogram name={athleteName} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-chalk truncate font-medium">
                          {athleteName}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground truncate">
                          {shortAddr(a.jobId, 6, 4)}
                        </div>
                      </div>
                      <StatusBadge status={a.status} />
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Past Sessions — completed jobs, each links to the full JobDetail view */}
        {(completedJobs.length > 0 || isLoading) && (
          <section className="mt-10">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
              <History className="w-3 h-3 text-amber" />
              Past sessions · {completedJobs.length}
            </h2>
            {isLoading ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 bg-card/50 border border-border/50 rounded-sm animate-pulse" />
                ))}
              </div>
            ) : (
              <ul className="grid sm:grid-cols-2 gap-3">
                {completedJobs.map((job, i) => {
                  const athlete = resolve(job.athlete);
                  const athleteName = athlete?.name ?? `Athlete ${job.athlete.slice(2, 6)}`;
                  return (
                    <motion.li
                      key={job.jobId}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <Link
                        href={`/coach/jobs/${job.jobId}`}
                        className="flex items-center gap-3 px-4 py-3 bg-card/40 hover:bg-card border border-border/50 hover:border-amber/40 rounded-sm transition-colors group"
                      >
                        <AthleteMonogram name={athleteName} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-chalk truncate font-medium">{athleteName}</div>
                          <div className="font-mono text-[10px] text-muted-foreground truncate">
                            {shortAddr(job.jobId, 6, 4)} · {timeUntil(job.createdAt)} ago · {formatStt(job.fee)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] uppercase tracking-wider font-bold text-amber bg-amber/10 border-amber/30">
                            <CheckCircle2 className="w-3 h-3" /> Done
                          </span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-amber transition-colors" />
                        </div>
                      </Link>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* Sessions — collapsible */}
        <section className="mt-10">
          <details open={jobs.length > 0 && jobs.length <= 10} className="group">
            <summary className="flex items-center justify-between gap-4 cursor-pointer list-none mb-4">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-0 -rotate-90" />
                All sessions{jobs.length > 0 ? ` · ${jobs.length}` : ""}
              </h2>
              {jobs.length > 0 && (
                <div className="flex gap-2 text-[10px] font-mono">
                  <span className="text-chalk/80">{stats.active} active</span>
                  {stats.expired > 0 && <span className="text-destructive">{stats.expired} expired</span>}
                  <span className="text-muted-foreground">{stats.completed} done</span>
                </div>
              )}
            </summary>

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-card/50 border border-border/50 rounded-sm animate-pulse" />
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="border-l-2 border-amber/30 pl-6 py-4"
              >
                <p className="font-serif-display text-2xl text-chalk mb-2">No sessions yet</p>
                <p className="text-muted-foreground font-mono text-[11px] uppercase tracking-widest">
                  Pick an athlete from your roster and open the first one.
                </p>
              </motion.div>
            ) : (
              <div className="border border-border/50 rounded-sm overflow-hidden">
                <div className="hidden md:grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 bg-card/40 border-b border-border/50 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                  <div>Athlete · Session</div>
                  <div>Status</div>
                  <div>Fee</div>
                  <div>Opened</div>
                  <div>Deadline</div>
                  <div className="text-right">Action</div>
                </div>
                <ul>
                  {jobs.map((job, i) => {
                    const now = Math.floor(Date.now() / 1000);
                    const expired = Number(job.deadline) <= now;
                    const canCancel =
                      expired && (job.status === "Requested" || job.status === "FormSubmitted");
                    const athlete = resolve(job.athlete);
                    const athleteName = athlete?.name ?? "Athlete";
                    return (
                      <motion.li
                        key={job.jobId}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="grid grid-cols-1 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_auto] gap-2 md:gap-4 items-center px-4 py-3 border-b border-border/30 last:border-b-0 hover:bg-card/30 transition-colors group"
                      >
                        <Link
                          href={`/coach/jobs/${job.jobId}`}
                          className="flex items-center gap-3 min-w-0"
                        >
                          <AthleteMonogram name={athleteName} size="md" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="font-serif-display text-base text-chalk truncate leading-tight">
                                {athleteName}
                              </div>
                              {athlete && <VerifiedBadge verified={athlete.verified} />}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground truncate">
                              {shortAddr(job.athlete, 6, 4)} · {shortAddr(job.jobId, 6, 4)}
                            </div>
                          </div>
                        </Link>
                        <div className="md:block">
                          <StatusBadge status={job.status} />
                        </div>
                        <div className="font-mono text-xs text-chalk/80">{formatStt(job.fee)}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {timeUntil(job.createdAt)} ago
                        </div>
                        <div>
                          <DeadlineCell deadline={job.deadline} status={job.status} />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          {canCancel ? (
                            <button
                              onClick={() => handleQuickCancel(job.jobId, job.fee)}
                              disabled={cancelling && cancellingId === job.jobId}
                              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-sm border border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/15 transition-colors disabled:opacity-50"
                              title={`Refund ${formatStt(job.fee)} back to your wallet`}
                            >
                              <X className="w-3 h-3" />
                              {cancelling && cancellingId === job.jobId ? "Cancelling…" : "Cancel & refund"}
                            </button>
                          ) : (
                            <Link
                              href={`/coach/jobs/${job.jobId}`}
                              className="text-muted-foreground hover:text-amber transition-colors"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Link>
                          )}
                        </div>
                      </motion.li>
                    );
                  })}
                </ul>
              </div>
            )}
          </details>
        </section>
      </main>
    </div>
  );
}
