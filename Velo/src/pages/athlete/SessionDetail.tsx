import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Hex } from "viem";
import { Link } from "wouter";
import { TopBar } from "@/components/TopBar";
import {
  useJob,
  useFormReceipt,
  usePrescriptionReceipt,
} from "@/hooks/useVeloContracts";
import { shortAddr, timeUntil, formatStt } from "@/lib/format";
import { fetchIndexedReceipts, type IndexedReceipts } from "@/lib/web3/indexer";
import { ShieldCheck, Clock, ArrowLeft } from "lucide-react";
import { CompositionTree, type CompositionNode } from "@/components/CompositionTree";
import { ReceiptStage, Stage, Row, decodeReceipt } from "@/components/session/ReceiptStage";
import { useIpfsJson, somniaReceiptUrlFromJson } from "@/lib/web3/ipfs";

/**
 * Read-only mirror of the coach's Session Detail timeline, scoped to the
 * athlete viewing their own permanent record. Reuses the same on-chain receipt
 * rendering + signature-verification machinery; intentionally omits any coach
 * actions (cancel / refund) since the athlete only reads their record.
 */
export default function SessionDetail({ jobId }: { jobId: Hex }) {
  // Live-poll on-chain state until the session reaches a terminal stage so an
  // in-flight session advances without a manual reload. `useJob` stops on its
  // own once Completed/Cancelled; the receipt + indexer queries stop on
  // cancellation (no receipt will arrive) and naturally once their data lands.
  const { data: job, isLoading: jobLoading } = useJob(jobId, { poll: true });
  const isCancelled = job?.status === "Cancelled";
  const isTerminal = isCancelled || job?.status === "Completed";
  const { data: formReceiptRaw } = useFormReceipt(jobId, { poll: !isCancelled });
  const { data: rxReceiptRaw } = usePrescriptionReceipt(jobId, {
    poll: !isCancelled,
  });

  const formReceipt = useMemo(() => decodeReceipt(formReceiptRaw), [formReceiptRaw]);
  const rxReceipt = useMemo(() => decodeReceipt(rxReceiptRaw), [rxReceiptRaw]);
  const { data: rxIpfs } = useIpfsJson(rxReceipt?.ipfsCid);
  const rxSomniaReceiptUrl = useMemo(() => somniaReceiptUrlFromJson(rxIpfs), [rxIpfs]);

  // Indexer-supplied {receipt, signature} — gates the "Verified" badge so the
  // athlete can prove each agent signed its receipt, exactly as the coach can.
  const indexerQ = useQuery({
    queryKey: ["velo:indexer:receipts", jobId],
    enabled: !!jobId && (!!formReceipt || !!rxReceipt),
    staleTime: 30_000,
    retry: false,
    refetchInterval: (query) => {
      const r = query.state.data;
      if (r?.status === "ready" && r.data.prescription) return false;
      if (isCancelled) return false;
      if (r?.status === "not-configured") return false;
      if (isTerminal && r?.status === "error") return false;
      return 5000;
    },
    queryFn: async () => fetchIndexedReceipts(jobId),
  });
  const indexed: IndexedReceipts | null =
    indexerQ.data?.status === "ready" ? indexerQ.data.data : null;

  if (jobLoading) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <TopBar />
        <div className="flex-1 p-12 flex items-center justify-center">
          <div className="animate-pulse w-8 h-8 rounded-full bg-border" />
        </div>
      </div>
    );
  }
  if (!job) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <TopBar />
        <div className="flex-1 p-12 flex flex-col items-center justify-center text-center">
          <h1 className="font-serif-display text-3xl text-chalk mb-4">Session Not Found</h1>
          <Link href="/athlete" className="text-amber hover:underline">
            Return to your records
          </Link>
        </div>
      </div>
    );
  }

  const isExpired = Date.now() / 1000 > Number(job.deadline);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <TopBar />

      <main className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-12 pb-24">
        <Link
          href="/athlete"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-chalk transition-colors text-sm font-medium mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Back to your records
        </Link>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-1">
              Session report
            </div>
            <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight leading-tight">
              Your training record
            </h1>
            <div className="font-mono text-[10px] text-muted-foreground mt-1 truncate">
              Coached by {shortAddr(job.coach, 6, 4)}
            </div>
          </div>
          <div className="px-3 py-1.5 bg-card border border-border/50 rounded-sm font-mono text-[11px] text-chalk/80 shrink-0">
            {shortAddr(jobId, 8, 8)}
          </div>
        </div>

        <div className="space-y-12 relative before:absolute before:inset-0 before:ml-[1.4rem] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-border/50">
          {/* Stage 1 — Opened */}
          <Stage
            done
            icon={<Clock className="w-5 h-5 text-ink" />}
            title="Session Opened"
            subtitle={`${timeUntil(job.createdAt)} ago`}
          >
            <div className="space-y-2 text-sm text-muted-foreground font-mono">
              <Row label="Coach" value={shortAddr(job.coach)} />
              <Row label="Athlete" value={shortAddr(job.athlete)} />
              <Row label="Fee" value={formatStt(job.fee)} />
              <Row label="Video CID" value={shortAddr(job.videoCid)} />
              <Row
                label="Deadline"
                value={timeUntil(job.deadline)}
                tone={isExpired ? "danger" : "amber"}
              />
            </div>
          </Stage>

          {(formReceipt || rxReceipt) && (
            <CompositionTree
              nodes={
                [
                  formReceipt
                    ? {
                        role: "lead",
                        agent: formReceipt.agent,
                        label: "Form agent",
                        receiptCid: formReceipt.ipfsCid,
                      }
                    : null,
                  rxReceipt
                    ? {
                        role: "sub",
                        agent: rxReceipt.agent,
                        label: "Prescriber",
                        receiptCid: rxReceipt.ipfsCid,
                        receiptUrl:
                          indexed?.prescription?.provenance?.path === "native"
                            ? indexed.prescription.provenance.somnia?.receiptUrl
                            : rxSomniaReceiptUrl ?? undefined,
                      }
                    : null,
                ].filter(Boolean) as CompositionNode[]
              }
            />
          )}

          {/* Stage 2 — Form Analysis */}
          <ReceiptStage
            kind="form"
            jobId={jobId}
            receipt={formReceipt}
            indexedEntry={indexed?.form ?? null}
            jobCreatedAt={job.createdAt}
            placeholderTitle="Awaiting Form agent"
            placeholderHint="Your coach's Form agent will submit a signed receipt on-chain."
          />

          {/* Stage 3 — Prescription */}
          <ReceiptStage
            kind="rx"
            jobId={jobId}
            receipt={rxReceipt}
            indexedEntry={indexed?.prescription ?? null}
            jobCreatedAt={job.createdAt}
            placeholderTitle="Awaiting Prescriber agent"
            placeholderHint="Your coach's Prescriber agent will submit a signed receipt on-chain."
          />

          {/* Stage 4 — Appended to SBT */}
          <Stage
            done={!!rxReceipt}
            icon={
              rxReceipt ? (
                <ShieldCheck className="w-5 h-5 text-ink" />
              ) : (
                <Clock className="w-5 h-5 text-muted-foreground" />
              )
            }
            title={rxReceipt ? "Appended to your SBT" : "Awaiting permanent record"}
          >
            {!rxReceipt ? (
              <p className="text-sm text-muted-foreground font-light">
                Once both receipts are submitted, this session is appended to your soulbound
                training record.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  This receipt is now part of your permanent, soulbound training record.
                </p>
                <div className="space-y-2 text-xs font-mono">
                  <Row label="Athlete" value={shortAddr(job.athlete)} />
                  <Row label="Summary hash" value={shortAddr(rxReceipt.summaryHash, 6, 6)} />
                  <Row label="Stored CID" value={shortAddr(rxReceipt.ipfsCid, 6, 6)} />
                </div>
              </>
            )}
          </Stage>
        </div>
      </main>
    </div>
  );
}
