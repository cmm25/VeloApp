import { useState } from "react";
import { Link } from "wouter";
import type { Address, Hex } from "viem";
import { TopBar } from "@/components/TopBar";
import {
  useBounty,
  useBids,
  useBountyTimeline,
  useAcceptBid,
  useExpireBounty,
  usePlaceBid,
  useBountyReport,
  parseSttToWei,
  describeBidError,
  type TimelineEntry,
} from "@/lib/domain/bounties";
import type { BountyFormReport } from "@/lib/web3/bountyIndexer";
import { useAgent, skillLabel } from "@/lib/domain/agents";
import { useAccount } from "wagmi";
import { shortAddr, formatStt, timeUntil } from "@/lib/format";
import { ipfsGatewayUrl } from "@/lib/web3/uploader";
import {
  ArrowLeft,
  Target,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Bot,
  GitBranch,
  ShieldAlert,
  Send,
  XCircle,
  Microscope,
  TrendingUp,
  TrendingDown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "./BountiesBoard";

export default function BountyDetail({ id: idParam }: { id: string }) {
  const idNum = (() => {
    try {
      return BigInt(idParam);
    } catch {
      return undefined;
    }
  })();
  const { data: bounty, isLoading, refetch: refetchBounty } = useBounty(idNum);
  const { bids, refetch: refetchBids } = useBids(idNum);
  const timelineQ = useBountyTimeline(idNum);
  const { accept, isPending: acceptPending } = useAcceptBid();
  const { expire, isPending: expirePending } = useExpireBounty();
  const { placeBid, isPending: bidPending } = usePlaceBid();
  const { address: me } = useAccount();

  const [bidFee, setBidFee] = useState("");
  const [bidDeadlineHours, setBidDeadlineHours] = useState(24);

  const reportQ = useBountyReport(idNum, bounty?.status === "Settled");

  const { data: myAgent, isLoading: myAgentLoading } = useAgent(me);

  const isPoster =
    !!bounty && !!me && bounty.poster.toLowerCase() === me.toLowerCase();
  const isExpired =
    !!bounty && Date.now() / 1000 > Number(bounty.deadline) && bounty.status === "Open";

  const isActiveAgent = !!myAgent && myAgent.exists && myAgent.active;
  const requiredSkills = bounty?.requiredSkills ?? [];
  const hasRequiredSkill =
    requiredSkills.length === 0 ||
    (!!myAgent &&
      requiredSkills.some((rs) =>
        myAgent.skills.some((s) => s.toLowerCase() === rs.toLowerCase()),
      ));
  const isEligibleAgent = isActiveAgent && hasRequiredSkill;

  // Bidding is open on this bounty for someone other than the poster…
  const bidOpen = !!bounty && bounty.status === "Open" && !isExpired && !isPoster;
  // …but only registered, active agents with a matching skill may actually bid.
  const canBid = bidOpen && !!me && isEligibleAgent;

  if (idNum === undefined) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <TopBar />
        <main className="flex-1 max-w-2xl w-full mx-auto p-12 text-center">
          <h1 className="font-serif-display text-3xl text-chalk mb-2">
            Invalid bounty
          </h1>
          <Link href="/bounties" className="text-amber hover:underline">
            Back to board
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
          href="/bounties"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-chalk transition-colors text-sm mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Bounty board
        </Link>

        {isLoading || !bounty ? (
          <div className="space-y-4">
            <div className="h-24 bg-card/50 border border-border/50 rounded-sm animate-pulse" />
            <div className="h-40 bg-card/50 border border-border/50 rounded-sm animate-pulse" />
          </div>
        ) : (
          <>
            <header className="flex flex-col md:flex-row md:items-center gap-6 mb-10 border-b border-border/50 pb-8">
              <div className="w-14 h-14 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
                <Target className="w-6 h-6 text-amber" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-2">
                  Bounty
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="font-serif-display text-3xl md:text-4xl text-chalk tracking-tight leading-tight">
                    Bounty #{bounty.id.toString()}
                  </h1>
                  <StatusBadge status={bounty.status} />
                </div>
                <div className="font-mono text-[10px] text-muted-foreground mt-2 truncate">
                  athlete {shortAddr(bounty.athlete, 6, 6)} · posted by{" "}
                  {shortAddr(bounty.poster, 6, 6)}
                </div>
              </div>
              <div className="flex flex-col gap-1 text-right shrink-0">
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                  Escrow
                </div>
                <div className="font-mono text-amber text-xl">
                  {formatStt(bounty.escrow)}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  deadline {timeUntil(bounty.deadline)}
                </div>
              </div>
            </header>

            <section className="mb-10">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
                Brief
              </h2>
              <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                <Row label="Video CID" value={shortAddr(bounty.videoCid, 8, 6)}>
                  {!bounty.videoCid.startsWith("local:") && (
                    <a
                      href={ipfsGatewayUrl(bounty.videoCid)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber hover:text-amber-soft ml-2 inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </Row>
                <RequiredSkills
                  skills={requiredSkills}
                  agentSkills={isActiveAgent ? myAgent?.skills : undefined}
                />
              </dl>
            </section>

            {isExpired && (
              <div className="mb-10 p-5 border border-destructive/30 bg-destructive/5 rounded-sm flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
                  <div>
                    <div className="text-sm text-chalk font-medium">
                      Deadline passed before any bid was accepted
                    </div>
                    <div className="text-xs text-muted-foreground font-light">
                      Anyone can refund the escrow to the poster.
                    </div>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await expire(bounty.id);
                      toast.success("Refund submitted");
                    } catch (e) {
                      toast.error("Refund failed", {
                        description: e instanceof Error ? e.message : String(e),
                      });
                    }
                  }}
                  disabled={expirePending}
                  className="px-3 py-2 bg-destructive/10 text-destructive hover:bg-destructive/20 text-xs font-bold uppercase tracking-widest rounded-sm disabled:opacity-50"
                >
                  Refund poster
                </button>
              </div>
            )}

            {bidOpen && !canBid && (
              <BidEligibilityNotice
                connected={!!me}
                loading={!!me && myAgentLoading}
                isActiveAgent={isActiveAgent}
                hasRequiredSkill={hasRequiredSkill}
              />
            )}

            {canBid && (
              <section className="mb-10">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                  <Send className="w-3.5 h-3.5 text-amber/70" /> Place a bid
                </h2>
                <div className="border border-border/50 bg-card/40 rounded-sm p-5">
                  <div className="grid sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                        Your fee (STT)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        placeholder="e.g. 0.05"
                        value={bidFee}
                        onChange={(e) => setBidFee(e.target.value)}
                        className="w-full bg-input border border-border focus:border-amber rounded-sm px-3 py-2 text-sm text-chalk font-mono placeholder:text-muted-foreground/50 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                        Delivery deadline (hours from now)
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={bidDeadlineHours}
                        onChange={(e) => setBidDeadlineHours(Number(e.target.value))}
                        className="w-full bg-input border border-border focus:border-amber rounded-sm px-3 py-2 text-sm text-chalk font-mono outline-none"
                      />
                    </div>
                  </div>
                  <button
                    disabled={bidPending || !bidFee}
                    onClick={async () => {
                      let feeWei: bigint;
                      try {
                        feeWei = parseSttToWei(bidFee);
                      } catch {
                        toast.error("Invalid fee amount");
                        return;
                      }
                      const deadlineTs = BigInt(
                        Math.floor(Date.now() / 1000) + bidDeadlineHours * 3600,
                      );
                      try {
                        await placeBid({
                          bountyId: bounty.id,
                          proposedFee: feeWei,
                          proposedDeadlineTs: deadlineTs,
                        });
                        toast.success("Bid placed");
                        setBidFee("");
                        refetchBids();
                        refetchBounty();
                      } catch (e) {
                        toast.error("Bid failed", {
                          description: describeBidError(e),
                        });
                      }
                    }}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber hover:bg-amber-soft disabled:opacity-50 text-ink text-xs font-bold uppercase tracking-widest rounded-sm transition-colors"
                  >
                    <Send className="w-3 h-3" />
                    {bidPending ? "Submitting…" : "Submit bid"}
                  </button>
                </div>
              </section>
            )}

            <section className="mb-10">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
                Bids · {bids.length}
              </h2>
              {bids.length === 0 ? (
                <p className="text-xs text-muted-foreground font-light">
                  No bids yet.
                </p>
              ) : (
                <ul className="border border-border/50 rounded-sm divide-y divide-border/30">
                  {bids.map((b) => (
                    <BidRow
                      key={b.bidId.toString()}
                      agent={b.agent}
                      proposedFee={b.proposedFee}
                      placedAt={b.placedAt}
                      canAccept={isPoster && bounty.status === "Open"}
                      isAccepted={
                        bounty.status !== "Open" &&
                        bounty.leadAgent.toLowerCase() === b.agent.toLowerCase()
                      }
                      onAccept={async () => {
                        try {
                          await accept(bounty.id, b.bidId);
                          toast.success("Bid accepted");
                          refetchBids();
                          refetchBounty();
                        } catch (e) {
                          toast.error("Accept failed", {
                            description: e instanceof Error ? e.message : String(e),
                          });
                        }
                      }}
                      busy={acceptPending}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-10">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                <GitBranch className="w-3.5 h-3.5 text-amber/70" /> Timeline
              </h2>
              {timelineQ.isLoading ? (
                <div className="h-24 bg-card/50 border border-border/50 rounded-sm animate-pulse" />
              ) : (
                <Timeline entries={timelineQ.data ?? []} />
              )}
            </section>

            {bounty.status === "Settled" && <SettledSplits entries={timelineQ.data ?? []} />}

            {bounty.status === "Settled" && (
              <BountyReportPanel reportQ={reportQ} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function BidEligibilityNotice({
  connected,
  loading,
  isActiveAgent,
  hasRequiredSkill,
}: {
  connected: boolean;
  loading: boolean;
  isActiveAgent: boolean;
  hasRequiredSkill: boolean;
}) {
  if (loading) {
    return (
      <section className="mb-10">
        <div className="h-20 bg-card/50 border border-border/50 rounded-sm animate-pulse" />
      </section>
    );
  }

  let message: string;
  if (!connected) {
    message =
      "Connect a wallet registered as an active coaching agent to place a bid.";
  } else if (!isActiveAgent) {
    message =
      "Only registered, active coaching agents can bid on bounties. Register your agent to participate.";
  } else if (!hasRequiredSkill) {
    message =
      "Your agent isn't registered for the skill this bounty requires, so it can't bid here.";
  } else {
    message = "This bounty isn't open to your wallet for bidding.";
  }

  return (
    <section className="mb-10">
      <div className="border border-border/50 bg-card/40 rounded-sm p-5 flex items-start gap-3">
        <ShieldAlert className="w-4 h-4 text-amber/80 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm text-chalk font-medium mb-1">
            Bidding is for registered agents
          </div>
          <p className="text-xs text-muted-foreground font-light">{message}</p>
          <Link
            href="/agents"
            className="inline-flex items-center gap-1 text-xs text-amber hover:text-amber-soft mt-2"
          >
            <Bot className="w-3 h-3" /> Browse the agent registry
          </Link>
        </div>
      </div>
    </section>
  );
}

function BidRow({
  agent,
  proposedFee,
  placedAt,
  canAccept,
  isAccepted,
  onAccept,
  busy,
}: {
  agent: Address;
  proposedFee: bigint;
  placedAt: bigint;
  canAccept: boolean;
  isAccepted: boolean;
  onAccept: () => void;
  busy: boolean;
}) {
  const { data: ag } = useAgent(agent);
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="w-9 h-9 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-amber/90" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/a/${agent}`}
            className="text-sm text-chalk hover:text-amber transition-colors font-medium"
          >
            {ag?.name || shortAddr(agent, 6, 4)}
          </Link>
          {ag && !ag.active && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-destructive bg-destructive/10 border border-destructive/30 px-1.5 py-0.5 rounded-sm">
              <ShieldAlert className="w-3 h-3" /> Deregistered
            </span>
          )}
          {isAccepted && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-amber bg-amber/10 border border-amber/30 px-1.5 py-0.5 rounded-sm">
              <CheckCircle2 className="w-3 h-3" /> Lead
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground truncate">
          {shortAddr(agent, 6, 4)} ·{" "}
          {placedAt > 0n
            ? new Date(Number(placedAt) * 1000).toLocaleString()
            : "—"}
        </div>
      </div>
      <div className="font-mono text-sm text-amber shrink-0">{formatStt(proposedFee)}</div>
      {canAccept && (
        <button
          onClick={onAccept}
          disabled={busy}
          className="shrink-0 px-3 py-1.5 bg-amber hover:bg-amber-soft text-ink text-[10px] uppercase tracking-widest font-bold rounded-sm disabled:opacity-50"
        >
          Accept
        </button>
      )}
    </li>
  );
}

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground font-light">
        No events yet — the timeline will fill in as agents act.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {entries.map((e, i) => (
        <li
          key={i}
          className="flex items-start gap-3 p-3 bg-card/40 border border-border/50 rounded-sm"
        >
          <Clock className="w-3.5 h-3.5 text-amber/70 mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-chalk font-medium">{e.kind}</div>
            <div className="text-[10px] font-mono text-muted-foreground truncate">
              {summarizeEntry(e)}
            </div>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground shrink-0">
            {e.ts > 0 ? new Date(e.ts * 1000).toLocaleString() : "—"}
          </div>
        </li>
      ))}
    </ol>
  );
}

function summarizeEntry(e: TimelineEntry): string {
  switch (e.kind) {
    case "BountyPosted":
      return `escrow ${formatStt(e.data.escrow)} · deadline ${timeUntil(e.data.deadline)}`;
    case "BidPlaced":
      return `bid ${shortAddr(e.data.agent)} · ${formatStt(e.data.proposedFee)}`;
    case "BidAccepted":
      return `lead ${shortAddr(e.data.leadAgent)} · ${formatStt(e.data.acceptedFee)}`;
    case "JobStarted":
      return `lead ${shortAddr(e.data.leadAgent)}`;
    case "SubContracted":
      return `sub ${shortAddr(e.data.subAgent)}`;
    case "Settled":
      return `paid ${formatStt(e.data.totalPaid)} across ${e.data.splits.length} agent(s)`;
    case "BountyExpired":
      return `refunded ${formatStt(e.data.refund)}`;
  }
}

function SettledSplits({ entries }: { entries: TimelineEntry[] }) {
  const settled = entries.find((e) => e.kind === "Settled");
  if (!settled || settled.kind !== "Settled") return null;
  const splits = settled.data.splits;
  const total = splits.reduce((s, x) => s + x.bps, 0) || 10_000;
  return (
    <section className="mb-10">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
        Payout split
      </h2>
      <div className="h-6 w-full flex rounded-sm overflow-hidden border border-border/50">
        {splits.map((s, i) => {
          const pct = (s.bps / total) * 100;
          const odd = i % 2 === 0;
          return (
            <div
              key={i}
              style={{ width: `${pct}%` }}
              className={`flex items-center justify-center text-[10px] font-mono ${
                odd ? "bg-amber text-ink" : "bg-chalk/20 text-chalk"
              }`}
              title={`${shortAddr(s.agent)} · ${(s.bps / 100).toFixed(1)}%`}
            >
              {pct >= 8 ? `${(s.bps / 100).toFixed(0)}%` : ""}
            </div>
          );
        })}
      </div>
      <ul className="mt-3 space-y-1 text-xs">
        {splits.map((s, i) => (
          <li key={i} className="flex justify-between font-mono text-chalk/80">
            <Link href={`/a/${s.agent}`} className="hover:text-amber">
              {shortAddr(s.agent, 6, 4)}
            </Link>
            <span>{(s.bps / 100).toFixed(2)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequiredSkills({
  skills,
  agentSkills,
}: {
  // bytes32 skill hashes this bounty requires
  skills: Hex[];
  // the connected agent's skills, or undefined when no active agent is connected
  agentSkills?: Hex[];
}) {
  return (
    <div className="bg-card/40 border border-border/50 px-4 py-3 rounded-sm">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        Required skills
      </div>
      {skills.length === 0 ? (
        <div className="font-mono text-xs text-chalk/80">
          None — open to any agent
        </div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {skills.map((s) => {
            const has =
              agentSkills?.some((a) => a.toLowerCase() === s.toLowerCase()) ??
              undefined;
            return (
              <li
                key={s}
                title={s}
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-sm border ${
                  has === true
                    ? "border-amber/40 bg-amber/10 text-amber"
                    : has === false
                      ? "border-destructive/30 bg-destructive/5 text-destructive/90"
                      : "border-border/50 bg-background/40 text-chalk/80"
                }`}
              >
                {has === true && <CheckCircle2 className="w-3 h-3" />}
                {has === false && <XCircle className="w-3 h-3" />}
                {skillLabel(s)}
              </li>
            );
          })}
        </ul>
      )}
      {agentSkills && skills.length > 0 && (
        <div className="text-[10px] text-muted-foreground font-light mt-2">
          Highlighted skills show what your agent does and doesn't have.
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-card/40 border border-border/50 px-4 py-3 rounded-sm">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </div>
      <div className="font-mono text-xs text-chalk/80 flex items-center">
        {value}
        {children}
      </div>
    </div>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  high: "text-destructive bg-destructive/10 border-destructive/30",
  medium: "text-amber bg-amber/10 border-amber/30",
  low: "text-muted-foreground bg-muted/10 border-muted/30",
};

function BountyReportPanel({
  reportQ,
}: {
  reportQ: ReturnType<typeof useBountyReport>;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
        <Microscope className="w-3.5 h-3.5 text-amber/70" /> AI Analysis Report
      </h2>

      {reportQ.isLoading || !reportQ.data ? (
        <div className="border border-border/50 bg-card/40 rounded-sm p-6 flex items-center gap-3 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-amber/70" />
          Waiting for agent runner to submit the report…
        </div>
      ) : reportQ.data.status === "error" ? (
        <div className="border border-destructive/30 bg-destructive/5 rounded-sm p-5 text-sm text-destructive/80">
          Could not load report — agent runner may be offline. ({reportQ.data.reason})
        </div>
      ) : reportQ.data.status === "pending" ? (
        <div className="border border-border/50 bg-card/40 rounded-sm p-6 flex items-center gap-3 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-amber/70" />
          Analysis in progress, will refresh automatically…
        </div>
      ) : reportQ.data.form.report ? (
        <FormReportCard
          report={reportQ.data.form.report}
          txHash={reportQ.data.form.txHash}
          explorerUrl={reportQ.data.form.explorerUrl}
        />
      ) : (
        <div className="border border-border/50 bg-card/40 rounded-sm p-5 text-sm text-muted-foreground">
          The agent submitted a receipt on-chain but the report body wasn't stored.{" "}
          <a
            href={reportQ.data.form.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-amber hover:underline inline-flex items-center gap-1"
          >
            View tx <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </section>
  );
}

function FormReportCard({
  report,
  txHash,
  explorerUrl,
}: {
  report: BountyFormReport;
  txHash: string;
  explorerUrl: string;
}) {
  return (
    <div className="border border-border/50 bg-card/40 rounded-sm divide-y divide-border/30">
      <div className="px-5 py-4 flex flex-wrap items-start gap-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
            Stroke type
          </div>
          <div className="text-sm text-chalk font-medium capitalize">
            {report.strokeType}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
            Form score
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-2xl text-amber">
              {report.overallScore.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">/ 10</span>
          </div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
            Key findings
          </div>
          <p className="text-sm text-chalk/90 font-light leading-relaxed">
            {report.keyFindings}
          </p>
        </div>
      </div>

      {report.issues.length > 0 && (
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-3.5 h-3.5 text-destructive/70" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Issues · {report.issues.length}
            </span>
          </div>
          <ul className="space-y-2">
            {report.issues.map((issue, i) => (
              <li
                key={i}
                className="flex flex-col sm:flex-row sm:items-start gap-2 p-3 rounded-sm border border-border/40 bg-background/30"
              >
                <span
                  className={`inline-flex items-center self-start text-[10px] uppercase tracking-widest font-bold border px-1.5 py-0.5 rounded-sm shrink-0 ${SEVERITY_STYLE[issue.severity] ?? SEVERITY_STYLE["low"]}`}
                >
                  {issue.severity}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-chalk font-medium">{issue.area}</div>
                  <div className="text-xs text-muted-foreground font-light mt-0.5">
                    {issue.description}
                  </div>
                  {issue.cue && (
                    <div className="text-xs text-amber/80 font-mono mt-1">
                      Cue: {issue.cue}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.strengths.length > 0 && (
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-3.5 h-3.5 text-amber/70" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Strengths · {report.strengths.length}
            </span>
          </div>
          <ul className="space-y-2">
            {report.strengths.map((s, i) => (
              <li
                key={i}
                className="flex flex-col sm:flex-row sm:items-start gap-2 p-3 rounded-sm border border-border/40 bg-background/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-chalk font-medium">{s.area}</div>
                  <div className="text-xs text-muted-foreground font-light mt-0.5">
                    {s.observation}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="font-mono text-[10px] text-muted-foreground">
          analysed {new Date(report.analysedAt).toLocaleString()} ·{" "}
          <span className="font-mono">{shortAddr(txHash, 6, 6)}</span>
        </div>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber hover:text-amber-soft"
        >
          Verify on-chain <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
