import { useEffect, useState } from "react";
import { Link } from "wouter";
import { isAddress, type Address } from "viem";
import { TopBar } from "@/components/TopBar";
import { AthleteMonogram } from "@/components/AthleteMonogram";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { AgentStatusBadge } from "@/components/AgentStatusBadge";
import { IndexerSourceBadge } from "@/components/IndexerSourceBadge";
import { AgentActivityStrip } from "@/components/AgentActivityStrip";
import { useAthleteReceipts, type SbtReceiptRef } from "@/hooks/useVeloContracts";
import { EmptyState } from "@/components/ui/states";
import { CompositionTree, type CompositionNode } from "@/components/CompositionTree";
import { useAthleteDirectory } from "@/lib/domain/athletes";
import { useTapes, formatTapeSize, formatTapeDate } from "@/lib/domain/tapes";
import { useCoachesForAthlete } from "@/lib/domain/roster";
import { useIpfsJson, summaryFromReport } from "@/lib/web3/ipfs";
import { ipfsGatewayUrl } from "@/lib/web3/uploader";
import { shortAddr, shortHash } from "@/lib/format";
import {
  ExternalLink,
  ShieldCheck,
  Activity,
  Film,
  Copy,
  ArrowLeft,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Public, wallet-free athlete profile at /p/:address.
 * Anyone with the link (coaches, clubs, the athlete themselves) can view it.
 */
export default function PublicProfile({ address: addrParam }: { address: string }) {
  const valid = isAddress(addrParam);
  const address = valid ? (addrParam as Address) : undefined;
  const { resolve, ensure } = useAthleteDirectory();
  useEffect(() => {
    if (address) ensure(address);
  }, [address, ensure]);

  const profile = address ? resolve(address) : null;
  const { receipts, count, tokenId, isLoading } = useAthleteReceipts(address);
  const tapesQ = useTapes(address);
  const tapes = tapesQ.data ?? [];
  const coachesQ = useCoachesForAthlete(address);
  const coaches = coachesQ.data ?? [];

  const [copied, setCopied] = useState(false);

  if (!valid) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <TopBar />
        <main className="flex-1 max-w-2xl w-full mx-auto p-12 text-center">
          <h1 className="font-serif-display text-3xl text-chalk mb-2">Invalid profile link</h1>
          <p className="text-muted-foreground font-light mb-8">
            The address in this URL doesn't look like a valid wallet.
          </p>
          <Link href="/" className="text-amber hover:underline">
            Back to Velo
          </Link>
        </main>
      </div>
    );
  }

  const lastReceipt = receipts[receipts.length - 1];
  const lastTs = lastReceipt ? Number(lastReceipt.timestamp) * 1000 : null;

  const shareLink = typeof window !== "undefined" ? window.location.href : "";
  const handleCopy = () => {
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      toast.success("Profile link copied");
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-amber/30 selection:text-amber">
      <TopBar />

      <main className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-12 pb-24">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-chalk transition-colors text-sm font-medium mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Velo
        </Link>

        <header className="mb-12 border-b border-border/50 pb-10">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            {profile && <AthleteMonogram name={profile.name} size="xl" />}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-2">
                Public athlete profile
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-serif-display text-4xl md:text-6xl text-chalk tracking-tight leading-tight">
                  {profile?.name ?? "Athlete"}
                </h1>
                {profile && <VerifiedBadge verified={profile.verified} size="md" />}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground mt-2 truncate">
                {address}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 items-center">
            <Stat label="SBT ID" value={tokenId.toString()} />
            <Stat label="Receipts" value={String(count)} />
            <Stat label="Library" value={String(tapes.length)} />
            <IndexerSourceBadge source="rpc" />
            {lastTs && (
              <Stat
                label="Last session"
                value={new Date(lastTs).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              />
            )}
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-amber hover:text-amber-soft border border-amber/40 hover:border-amber px-3 py-2 rounded-sm transition-colors"
            >
              <Copy className="w-3 h-3" />
              {copied ? "Copied" : "Copy share link"}
            </button>
          </div>
        </header>

        {coaches.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
              Coaches · {coaches.length}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {coaches.map((c) => {
                const label = c.coachName ?? `Coach ${shortAddr(c.coachAddress, 6, 4)}`;
                return (
                  <li
                    key={c.coachAddress}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-card/40 border border-border/50 rounded-sm"
                  >
                    <AthleteMonogram name={label} size="sm" />
                    <div className="min-w-0">
                      <div className="text-sm text-chalk truncate font-medium">{label}</div>
                      <div className="font-mono text-[10px] text-muted-foreground truncate">
                        {shortAddr(c.coachAddress, 6, 4)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {tapes.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
              Recent tapes
            </h2>
            <ul className="grid sm:grid-cols-2 gap-3">
              {tapes.slice(0, 4).map((t) => (
                <li
                  key={t.id}
                  className="p-3 bg-card/40 border border-border/50 rounded-sm flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
                    <Film className="w-4 h-4 text-amber/80" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-chalk truncate">
                      {t.label ?? "Untitled tape"}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground truncate">
                      {formatTapeDate(t.createdAt)} · {formatTapeSize(t.sizeBytes)}
                    </div>
                  </div>
                  {!t.cid.startsWith("local:") && (
                    <a
                      href={ipfsGatewayUrl(t.cid)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-amber"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <AgentActivityStrip />

        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Verified receipt timeline
          </h2>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-32 bg-card/50 border border-border/50 rounded-sm animate-pulse"
                />
              ))}
            </div>
          ) : receipts.length === 0 ? (
            <EmptyState icon={FileText} title="No receipts yet" />
          ) : (
            <div className="space-y-4">
              {receipts
                .slice()
                .reverse()
                .map((r) => (
                  <PublicReceiptRow key={r.jobId} r={r} />
                ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function PublicReceiptRow({ r }: { r: SbtReceiptRef }) {
  const { data: ipfs, isLoading } = useIpfsJson(r.ipfsCid);
  const summary = summaryFromReport(ipfs);
  const compositionNodes: CompositionNode[] = [
    { role: "lead", agent: r.formAgent, label: "Form agent", receiptCid: r.ipfsCid },
    { role: "sub", agent: r.prescriptionAgent, label: "Prescriber", receiptCid: r.ipfsCid },
  ];
  return (
    <div className="p-6 bg-card border border-border/50 rounded-sm">
      <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-amber text-sm">
              {new Date(Number(r.timestamp) * 1000).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-amber bg-amber/10 border border-amber/30 px-2 py-0.5 rounded-sm">
              <ShieldCheck className="w-3 h-3" />
              Provenance on-chain
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              Session {shortAddr(r.jobId, 6, 4)}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Form agent
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs text-chalk/80">
                <ShieldCheck className="w-3.5 h-3.5 text-amber/70" /> {shortAddr(r.formAgent)}
              </div>
              <AgentStatusBadge agent={r.formAgent} />
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Prescription agent
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs text-chalk/80">
                <ShieldCheck className="w-3.5 h-3.5 text-amber/70" />{" "}
                {shortAddr(r.prescriptionAgent)}
              </div>
              <AgentStatusBadge agent={r.prescriptionAgent} />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 md:items-end shrink-0">
          <div className="text-left md:text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Summary hash
            </div>
            <div className="font-mono text-xs text-chalk/60">{shortHash(r.summaryHash)}</div>
          </div>
          {r.ipfsCid && !r.ipfsCid.startsWith("local:") && (
            <a
              href={ipfsGatewayUrl(r.ipfsCid)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber hover:text-amber-soft"
            >
              Raw JSON <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border/40">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
          Session summary
        </div>
        {r.ipfsCid.startsWith("local:") ? (
          <p className="text-sm text-muted-foreground font-light">
            Local-only receipt (demo CID).
          </p>
        ) : isLoading ? (
          <div className="h-4 w-2/3 bg-border/40 rounded-sm animate-pulse" />
        ) : summary ? (
          <p className="text-sm text-chalk/90 leading-relaxed">{summary}</p>
        ) : (
          <p className="text-xs text-muted-foreground font-light">
            Receipt JSON did not include a readable summary.
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-mono">
          <div className="text-muted-foreground flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-amber/70" />
            summaryHash {shortHash(r.summaryHash)}
          </div>
          {!r.ipfsCid.startsWith("local:") && (
            <div className="text-muted-foreground truncate" title={r.ipfsCid}>
              ipfs {r.ipfsCid.slice(0, 14)}…
            </div>
          )}
        </div>
        <div className="mt-4">
          <CompositionTree nodes={compositionNodes} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border/50 px-4 py-3 rounded-sm flex items-center gap-4">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="font-serif-display text-chalk text-2xl leading-none">{value}</span>
    </div>
  );
}
