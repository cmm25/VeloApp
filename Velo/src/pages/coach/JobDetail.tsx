import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Hex } from "viem";
import { Link } from "wouter";
import { TopBar } from "@/components/TopBar";
import { AthleteMonogram } from "@/components/AthleteMonogram";
import {
  useJob,
  useFormReceipt,
  usePrescriptionReceipt,
  orchestratorAddress,
  useCancelExpired,
} from "@/hooks/useVeloContracts";
import { useAthleteDirectory } from "@/lib/domain/athletes";
import { shortAddr, timeUntil, formatStt } from "@/lib/format";
import {
  fetchIndexedReceipts,
  type IndexedReceipts,
} from "@/lib/web3/indexer";
import { veloOrchestratorAbi } from "@/lib/web3/abis";
import { ShieldCheck, Clock, AlertTriangle, ArrowLeft } from "lucide-react";
import { CompositionTree, type CompositionNode } from "@/components/CompositionTree";
import { ReceiptStage, Stage, Row, decodeReceipt } from "@/components/session/ReceiptStage";
import { TelemetryPreview } from "@/components/session/TelemetryPreview";
import { IndexerSourceBadge } from "@/components/IndexerSourceBadge";
import { useIpfsJson, somniaReceiptUrlFromJson } from "@/lib/web3/ipfs";

export default function JobDetail({ jobId }: { jobId: Hex }) {
  // Live-poll on-chain state until the session reaches a terminal stage so the
  // timeline advances without a manual reload while the agents are working.
  // `useJob` stops polling on its own once the job is Completed/Cancelled; the
  // receipt + indexer queries are told to stop on cancellation (no receipt will
  // ever arrive) and stop naturally once their data lands for completed jobs.
  const { data: job, isLoading: jobLoading } = useJob(jobId, { poll: true });
  const isCancelled = job?.status === "Cancelled";
  const isTerminal = isCancelled || job?.status === "Completed";
  const { data: formReceiptRaw } = useFormReceipt(jobId, { poll: !isCancelled });
  const { data: rxReceiptRaw } = usePrescriptionReceipt(jobId, {
    poll: !isCancelled,
  });
  const { writeContract: cancel } = useCancelExpired();
  const { resolve, ensure } = useAthleteDirectory();

  const formReceipt = useMemo(() => decodeReceipt(formReceiptRaw), [formReceiptRaw]);
  const rxReceipt = useMemo(() => decodeReceipt(rxReceiptRaw), [rxReceiptRaw]);
  const { data: rxIpfs } = useIpfsJson(rxReceipt?.ipfsCid);
  const rxSomniaReceiptUrl = useMemo(() => somniaReceiptUrlFromJson(rxIpfs), [rxIpfs]);

  // Indexer-supplied {receipt, signature} — gates the "Verified" badge so we
  // can prove the agent signed each receipt without trusting the orchestrator.
  // Poll until the prescription provenance is hydrated, then stop. Bail out on
  // cancellation, a disabled indexer, or a terminal job whose indexer errors,
  // so finished pages don't poll forever.
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

  useEffect(() => {
    if (job?.athlete) ensure(job.athlete);
  }, [job?.athlete, ensure]);
  const athlete = job ? resolve(job.athlete) : null;

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
          <Link href="/coach" className="text-amber hover:underline">
            Return to sessions
          </Link>
        </div>
      </div>
    );
  }

  const isExpired = Date.now() / 1000 > Number(job.deadline);
  const canCancel = isExpired && (job.status === "Requested" || job.status === "FormSubmitted");

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <TopBar />

      <main className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-12 pb-24">
        <Link
          href="/coach"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-chalk transition-colors text-sm font-medium mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sessions
        </Link>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div className="flex items-center gap-5 min-w-0">
            {athlete && <AthleteMonogram name={athlete.name} size="xl" />}
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-1">
                Session for
              </div>
              <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight leading-tight">
                {athlete?.name ?? "Athlete"}
              </h1>
              {job && (
                <div className="font-mono text-[10px] text-muted-foreground mt-1 truncate">
                  {shortAddr(job.athlete, 6, 4)}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
            <div className="px-3 py-1.5 bg-card border border-border/50 rounded-sm font-mono text-[11px] text-chalk/80">
              {shortAddr(jobId, 8, 8)}
            </div>
            <IndexerSourceBadge source="indexer" />
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

          {/* Vision Analysis Preview — shows raw MediaPipe telemetry once form receipt lands */}
          {formReceipt?.ipfsCid && !formReceipt.ipfsCid.startsWith("local:") && (
            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
              <div className="flex items-center justify-center w-12 h-12 rounded-full border-[3px] border-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-[0_0_0_4px_hsl(var(--background))] z-10 bg-amber/30">
                <svg className="w-5 h-5 text-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)]">
                <TelemetryPreview ipfsCid={formReceipt.ipfsCid} />
              </div>
            </div>
          )}

          {/* Stage 2 — Form Analysis */}
          <ReceiptStage
            kind="form"
            jobId={jobId}
            receipt={formReceipt}
            indexedEntry={indexed?.form ?? null}
            jobCreatedAt={job.createdAt}
            jobDeadline={job.deadline}
            placeholderTitle="Awaiting Form agent"
            placeholderHint="Form agent will submit signed receipt on-chain."
          />

          {/* Stage 3 — Prescription */}
          <ReceiptStage
            kind="rx"
            jobId={jobId}
            receipt={rxReceipt}
            indexedEntry={indexed?.prescription ?? null}
            jobCreatedAt={job.createdAt}
            jobDeadline={job.deadline}
            placeholderTitle="Awaiting Prescriber agent"
            placeholderHint="Prescriber agent will submit signed receipt on-chain."
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
            title={rxReceipt ? "Appended to SBT" : "Awaiting permanent record"}
          >
            {!rxReceipt ? (
              <p className="text-sm text-muted-foreground font-light">
                Once both receipts are submitted, the session is appended to the athlete's
                soulbound training record.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Receipt is now part of{" "}
                  <span className="text-chalk">{athlete?.name ?? "the athlete"}</span>'s
                  permanent training record.
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

        {canCancel && (
          <div className="mt-16 p-6 border border-destructive/30 bg-destructive/5 rounded-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h4 className="text-destructive font-medium flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4" /> Deadline Expired
                </h4>
                <p className="text-sm text-muted-foreground">
                  Agents failed to complete the analysis in time. You can cancel and refund your fee.
                </p>
              </div>
              <button
                onClick={() =>
                  cancel({
                    address: orchestratorAddress()!,
                    abi: veloOrchestratorAbi,
                    functionName: "cancelExpired",
                    args: [jobId],
                  })
                }
                className="px-4 py-2 bg-destructive/10 text-destructive hover:bg-destructive/20 font-medium text-sm rounded-sm transition-colors whitespace-nowrap"
              >
                Cancel &amp; Refund
              </button>
            </div>
            <div className="mt-4 pt-4 border-t border-destructive/20 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">
                  Refund amount
                </div>
                <div className="font-mono text-amber text-base">{formatStt(job.fee)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">
                  Returned to
                </div>
                <div className="font-mono text-chalk/80">{shortAddr(job.coach, 6, 6)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">
                  Gas
                </div>
                <div className="font-mono text-chalk/80">paid by you (small)</div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
