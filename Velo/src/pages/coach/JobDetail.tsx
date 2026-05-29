import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import {
  decodeFunctionData,
  hashTypedData,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
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
import { toStrokeReport, toPrescriptionPlan } from "@/lib/domain/tennis";
import {
  verifyReceipt,
  domainFor,
  RECEIPT_TYPES,
  type ReceiptStruct,
} from "@/lib/web3/eip712";
import { ipfsGatewayUrl } from "@/lib/web3/uploader";
import {
  fetchIndexedReceipts,
  type IndexedEntry,
  type IndexedReceipts,
  type AiProvenance,
} from "@/lib/web3/indexer";
import { somniaTestnet } from "@/lib/web3/chain";
import { veloOrchestratorAbi } from "@/lib/web3/abis";
import {
  Check,
  X,
  ShieldCheck,
  ShieldAlert,
  Clock,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Loader2,
  Hash,
  Database,
  Cpu,
  Zap,
} from "lucide-react";
import { AgentStatusBadge } from "@/components/AgentStatusBadge";
import { CompositionTree, type CompositionNode } from "@/components/CompositionTree";

const ZERO = "0x0000000000000000000000000000000000000000";

type ReceiptKind = "form" | "rx";

type DecodedReceipt = ReceiptStruct;

function decodeReceipt(raw: unknown): DecodedReceipt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if ((r.agent as string)?.toLowerCase() === ZERO) return null;
  return {
    jobId: r.jobId as Hex,
    agent: r.agent as Address,
    ipfsCid: r.ipfsCid as string,
    summaryHash: r.summaryHash as Hex,
    summary: r.summary as string,
    nonce: r.nonce as bigint,
    deadline: r.deadline as bigint,
    priorReceiptHash: r.priorReceiptHash as Hex,
  };
}

export default function JobDetail({ jobId }: { jobId: Hex }) {
  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: formReceiptRaw } = useFormReceipt(jobId);
  const { data: rxReceiptRaw } = usePrescriptionReceipt(jobId);
  const { writeContract: cancel } = useCancelExpired();
  const { resolve, ensure } = useAthleteDirectory();

  const formReceipt = useMemo(() => decodeReceipt(formReceiptRaw), [formReceiptRaw]);
  const rxReceipt = useMemo(() => decodeReceipt(rxReceiptRaw), [rxReceiptRaw]);

  // Indexer-supplied {receipt, signature} — gates the "Verified" badge so we
  // can prove the agent signed each receipt without trusting the orchestrator.
  const indexerQ = useQuery({
    queryKey: ["velo:indexer:receipts", jobId],
    enabled: !!jobId && (!!formReceipt || !!rxReceipt),
    staleTime: 30_000,
    retry: false,
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
            placeholderTitle="Awaiting Form agent"
            placeholderHint="Form agent will submit signed receipt on-chain."
            render={(r, ipfs) => {
              const stroke = toStrokeReport(ipfs ?? {}, r.summary);
              return (
                <>
                  <h3 className="font-serif-display text-2xl text-chalk mb-1">{stroke.stroke}</h3>
                  <p className="text-sm text-amber mb-4">{stroke.sessionGoal}</p>
                  <SummaryBlock label="Form agent summary" text={r.summary} />
                  {stroke.strengths.length > 0 && (
                    <Section title="Strengths">
                      <ul className="space-y-2">
                        {stroke.strengths.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-chalk/90">
                            <Check className="w-4 h-4 text-amber shrink-0 mt-0.5" />
                            <span className="leading-relaxed">{s}</span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                  {stroke.faults.length > 0 && (
                    <Section title="Faults">
                      <ul className="space-y-3">
                        {stroke.faults.map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <X className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                            <div>
                              <span className="font-medium text-chalk block mb-0.5">{f.area}</span>
                              <span className="text-muted-foreground leading-relaxed">
                                {f.detail}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                  {stroke.metrics.length > 0 && (
                    <Section title="Metrics">
                      <div className="grid grid-cols-2 gap-4">
                        {stroke.metrics.map((m, i) => (
                          <div key={i}>
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                              {m.label}
                            </div>
                            <div className="font-mono text-chalk text-sm">{m.value}</div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}
                </>
              );
            }}
          />

          {/* Stage 3 — Prescription */}
          <ReceiptStage
            kind="rx"
            jobId={jobId}
            receipt={rxReceipt}
            indexedEntry={indexed?.prescription ?? null}
            placeholderTitle="Awaiting Prescriber agent"
            placeholderHint="Prescriber agent will submit signed receipt on-chain."
            render={(r, ipfs) => {
              const rx = toPrescriptionPlan(ipfs ?? {}, r.summary);
              return (
                <>
                  <h3 className="font-serif-display text-2xl text-chalk mb-1">{rx.headline}</h3>
                  <p className="text-sm text-amber mb-4">{rx.sessionGoal}</p>
                  <SummaryBlock label="Prescription agent summary" text={r.summary} />
                  {rx.technicalFocus.length > 0 && (
                    <div className="bg-background border-l-2 border-amber pl-4 py-2 mb-4">
                      <h4 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
                        Technical Focus
                      </h4>
                      <div className="space-y-4">
                        {rx.technicalFocus.map((t, i) => (
                          <div key={i}>
                            <div className="font-medium text-chalk mb-1">
                              {t.drill}
                              {t.reps && (
                                <span className="text-muted-foreground font-mono text-xs ml-2">
                                  {t.reps}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-chalk/70 leading-relaxed border-l border-border/50 pl-3 py-1">
                              {t.cue}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {rx.warmUp.length > 0 && (
                    <Section title="Warm Up">
                      <ul className="list-disc list-inside space-y-1 text-sm text-chalk/80 ml-4">
                        {rx.warmUp.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </Section>
                  )}
                  {rx.conditioning.length > 0 && (
                    <Section title="Conditioning">
                      <ul className="list-disc list-inside space-y-1 text-sm text-chalk/80 ml-4">
                        {rx.conditioning.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </Section>
                  )}
                </>
              );
            }}
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

// ---------- Layout primitives ----------

function Stage({
  done,
  icon,
  title,
  subtitle,
  children,
}: {
  done: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
      <div
        className={`flex items-center justify-center w-12 h-12 rounded-full border-[3px] border-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-[0_0_0_4px_hsl(var(--background))] z-10 ${
          done ? "bg-amber" : "bg-border"
        }`}
      >
        {icon}
      </div>
      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] p-6 bg-card/30 border border-border/50 rounded-sm">
        <div className="flex justify-between items-start mb-4">
          <h3 className="font-serif-display text-xl text-chalk">{title}</h3>
          {subtitle && <span className="text-xs font-mono text-muted-foreground">{subtitle}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "danger";
}) {
  return (
    <div className="flex justify-between">
      <span className="text-chalk/50">{label}</span>
      <span
        className={
          tone === "danger" ? "text-destructive" : tone === "amber" ? "text-amber" : "text-chalk/80"
        }
      >
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h4 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
        {title}
      </h4>
      {children}
    </div>
  );
}

function SummaryBlock({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="my-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1.5">
        {label}
      </div>
      <p className="text-sm text-chalk/90 leading-relaxed">{text}</p>
    </div>
  );
}

// ---------- Receipt stage with IPFS + verifier ----------

function ReceiptStage({
  kind,
  jobId,
  receipt,
  indexedEntry,
  placeholderTitle,
  placeholderHint,
  render,
}: {
  kind: ReceiptKind;
  jobId: Hex;
  receipt: DecodedReceipt | null;
  indexedEntry: IndexedEntry | null;
  placeholderTitle: string;
  placeholderHint: string;
  render: (r: DecodedReceipt, ipfs: unknown | null) => React.ReactNode;
}) {
  const ipfsQuery = useIpfsJson(receipt?.ipfsCid);
  const [verifyState, setVerifyState] = useState<VerifyState>({ phase: "idle" });
  const verifiedOk = verifyState.phase === "verified" && verifyState.ok;

  return (
    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
      <div
        className={`flex items-center justify-center w-12 h-12 rounded-full border-[3px] border-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-[0_0_0_4px_hsl(var(--background))] z-10 ${
          receipt ? "bg-amber" : "bg-border"
        }`}
      >
        {receipt ? (
          <Check className="w-5 h-5 text-ink" />
        ) : (
          <Clock className="w-5 h-5 text-muted-foreground" />
        )}
      </div>

      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)]">
        {!receipt ? (
          <div className="p-6 bg-transparent border border-dashed border-border/50 rounded-sm text-center">
            <p className="font-serif-display text-lg text-chalk/60 mb-2">
              {placeholderTitle}
            </p>
            <p className="text-sm text-muted-foreground font-light">{placeholderHint}</p>
          </div>
        ) : (
          <div className="p-6 bg-card border border-amber/20 rounded-sm shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            <div className="flex justify-between items-start mb-4 gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                  {kind === "form" ? "Form Receipt" : "Prescription Receipt"}
                </div>
                <ProvenanceBadge verified={verifiedOk} />
              </div>
              <a
                href={
                  receipt.ipfsCid.startsWith("local:")
                    ? undefined
                    : ipfsGatewayUrl(receipt.ipfsCid)
                }
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center gap-1 text-[10px] font-mono ${
                  receipt.ipfsCid.startsWith("local:")
                    ? "text-muted-foreground pointer-events-none"
                    : "text-amber hover:text-amber-soft"
                }`}
              >
                IPFS <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {render(receipt, ipfsQuery.data ?? null)}

            <SomniaProvenancePanel provenance={indexedEntry?.provenance ?? null} />

            <ReceiptIntegrityPanel
              kind={kind}
              jobId={jobId}
              receipt={receipt}
              indexedEntry={indexedEntry}
              state={verifyState}
              setState={setVerifyState}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Somnia native-agent provenance ----------

/**
 * Shows whether this AI step was produced by Somnia's native LLM Inference
 * agent (consensus-verified, with an on-chain receipt) or by the off-chain
 * Groq fallback — and links to the public consensus receipt by request ID.
 */
function SomniaProvenancePanel({ provenance }: { provenance: AiProvenance | null }) {
  if (!provenance) return null;
  const isNative = provenance.path === "native";
  const somnia = provenance.somnia;

  return (
    <div
      className={`mt-4 rounded-sm border p-4 ${
        isNative
          ? "border-amber/30 bg-amber/[0.04]"
          : "border-border/50 bg-background/40"
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          {isNative ? (
            <Cpu className="w-4 h-4 text-amber" />
          ) : (
            <Zap className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-[10px] uppercase tracking-widest font-bold text-chalk/80">
            {isNative ? "Somnia Native Agent" : "Groq Fallback"}
          </span>
        </div>
        <span
          className={`text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-sm border ${
            isNative
              ? "border-amber/40 bg-amber/10 text-amber"
              : "border-border/60 bg-card text-muted-foreground"
          }`}
        >
          {isNative ? "Consensus" : "Off-chain"}
        </span>
      </div>

      {isNative ? (
        <>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Reasoned on Somnia's Agentic L1 by the native LLM Inference agent and
            verified by validator consensus.
          </p>
          <div className="space-y-1.5 text-[11px] font-mono">
            {somnia?.requestId && (
              <Row label="Request ID" value={somnia.requestId} />
            )}
            {somnia?.agentId && <Row label="Agent ID" value={somnia.agentId} />}
            {somnia?.consensusStatus && (
              <Row label="Consensus" value={somnia.consensusStatus} tone="amber" />
            )}
          </div>
          {somnia?.receiptUrl && (
            <a
              href={somnia.receiptUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-[10px] font-mono text-amber hover:text-amber-soft"
            >
              View consensus receipt <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Somnia native agents were unavailable, so this verdict was produced by
          the off-chain fallback model.
          {provenance.fallbackReason ? ` (${provenance.fallbackReason})` : ""}
        </p>
      )}
    </div>
  );
}

// ---------- Integrity / verifier panel ----------

type VerifyState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "no-sig"; reason: string }
  | { phase: "verified"; recovered: Address; signature: Hex; ok: boolean };

function ReceiptIntegrityPanel({
  kind,
  jobId,
  receipt,
  indexedEntry,
  state,
  setState,
}: {
  kind: ReceiptKind;
  jobId: Hex;
  receipt: DecodedReceipt;
  indexedEntry: IndexedEntry | null;
  state: VerifyState;
  setState: (s: VerifyState) => void;
}) {
  const client = usePublicClient({ chainId: somniaTestnet.id });
  const orch = orchestratorAddress();

  // Recompute the EIP-712 digest + summary hash locally — pure / always available.
  const digest = useMemo<Hex | null>(() => {
    if (!orch) return null;
    try {
      return hashTypedData({
        domain: domainFor(orch, somniaTestnet.id),
        types: RECEIPT_TYPES,
        primaryType: "Receipt",
        message: receipt,
      });
    } catch {
      return null;
    }
  }, [orch, receipt]);

  const summaryHashLocal = useMemo<Hex | null>(() => {
    try {
      return keccak256(toBytes(receipt.summary));
    } catch {
      return null;
    }
  }, [receipt.summary]);

  const summaryHashMatch =
    summaryHashLocal && summaryHashLocal.toLowerCase() === receipt.summaryHash.toLowerCase();

  const runVerify = async () => {
    if (!orch) return;
    setState({ phase: "loading" });
    try {
      // Prefer the indexer signature when the api-server has it — that's the
      // whole point of the indexer: no chain log walk needed.
      let signature: Hex | null = indexedEntry?.signature ?? null;

      if (!signature) {
        if (!client) {
          setState({ phase: "no-sig", reason: "RPC client unavailable" });
          return;
        }
        const eventName =
          kind === "form" ? "FormReceiptSubmitted" : "PrescriptionSubmitted";
        const event = veloOrchestratorAbi.find(
          (x) => x.type === "event" && x.name === eventName,
        );
        if (!event) {
          setState({ phase: "no-sig", reason: "Event ABI missing" });
          return;
        }
        const logs = (await client.getLogs({
          address: orch,
          event: event as never,
          args: { jobId } as never,
          fromBlock: 0n,
          toBlock: "latest",
        })) as Array<{ transactionHash: Hex | null }>;
        if (logs.length === 0) {
          setState({ phase: "no-sig", reason: "No submission log on chain" });
          return;
        }
        const txHash = logs[0].transactionHash;
        if (!txHash) {
          setState({ phase: "no-sig", reason: "Log missing tx hash" });
          return;
        }
        const tx = await client.getTransaction({ hash: txHash });
        const decoded = decodeFunctionData({
          abi: veloOrchestratorAbi,
          data: tx.input,
        }) as { functionName: string; args: readonly unknown[] };
        const fnName =
          kind === "form" ? "submitFormReceipt" : "submitPrescription";
        if (decoded.functionName !== fnName) {
          setState({
            phase: "no-sig",
            reason: `Unexpected function: ${decoded.functionName}`,
          });
          return;
        }
        signature = decoded.args[1] as Hex;
      }

      const { ok, recovered } = await verifyReceipt(
        receipt,
        signature,
        domainFor(orch, somniaTestnet.id),
      );
      setState({ phase: "verified", ok, recovered, signature });
    } catch (err) {
      console.error("verify failed", err);
      setState({ phase: "no-sig", reason: "Verification threw — check console" });
    }
  };

  // Auto-verify when the indexer hands us a signature. Keeps the "Verified"
  // badge truthful without making the user click a button.
  useEffect(() => {
    if (!indexedEntry || !orch) return;
    if (state.phase !== "idle") return;
    void runVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexedEntry?.signature, orch]);

  return (
    <div className="mt-6 pt-5 border-t border-border/50 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-xs uppercase tracking-widest text-muted-foreground font-bold flex items-center gap-2">
          <Hash className="w-3.5 h-3.5" /> Integrity
        </h4>
        <button
          onClick={runVerify}
          disabled={state.phase === "loading"}
          className="text-[11px] uppercase tracking-wider font-bold px-3 py-1.5 rounded-sm border border-amber/40 bg-amber/10 text-amber hover:bg-amber/20 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {state.phase === "loading" ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> Verifying…
            </>
          ) : (
            <>
              <ShieldCheck className="w-3 h-3" /> Verify signature
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 text-[11px] font-mono">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground shrink-0">Claimed agent</span>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="text-chalk/80 break-all">{receipt.agent}</span>
            <AgentStatusBadge agent={receipt.agent} />
          </div>
        </div>
        <KV
          label="Stored summaryHash"
          value={receipt.summaryHash}
        />
        <KV
          label="Local keccak256(summary)"
          value={summaryHashLocal ?? "—"}
          tone={summaryHashMatch ? "ok" : "warn"}
          hint={summaryHashMatch ? "matches on-chain digest" : "does not match — summary may be off"}
        />
        <KV label="EIP-712 digest" value={digest ?? "—"} />
        {indexedEntry && (
          <>
            <KV
              label="ipfsCid"
              value={receipt.ipfsCid}
            />
            <KV
              label="Submission tx"
              value={indexedEntry.txHash}
            />
            <KV
              label="Submission block"
              value={indexedEntry.blockNumber.toString()}
            />
          </>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono pt-1">
        <span className="text-muted-foreground inline-flex items-center gap-1.5">
          <Database className="w-3 h-3 text-amber/70" />
          {indexedEntry ? "signature from api-server indexer" : "signature from on-chain calldata"}
        </span>
        <span className="text-muted-foreground">chain {somniaTestnet.id}</span>
      </div>

      {state.phase === "verified" && (
        <div
          className={`flex items-start gap-2 p-3 rounded-sm border ${
            state.ok
              ? "border-amber/40 bg-amber/5 text-amber"
              : "border-destructive/40 bg-destructive/5 text-destructive"
          }`}
        >
          {state.ok ? (
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <div className="text-[11px] font-mono leading-relaxed">
            <div className="font-bold uppercase tracking-wider mb-1">
              {state.ok ? "Signature verified" : "Signature mismatch"}
            </div>
            <div className="text-chalk/80">
              Recovered <span className="text-chalk">{shortAddr(state.recovered, 6, 6)}</span>{" "}
              {state.ok ? "==" : "≠"}{" "}
              <span className="text-chalk">{shortAddr(receipt.agent, 6, 6)}</span>
            </div>
            <div className="text-chalk/50 mt-1 break-all">sig {shortAddr(state.signature, 10, 8)}</div>
          </div>
        </div>
      )}

      {state.phase === "no-sig" && (
        <div className="flex items-center gap-2 p-3 rounded-sm border border-border/50 bg-card/50 text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="text-[11px]">{state.reason}</span>
        </div>
      )}
    </div>
  );
}

function ProvenanceBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-sm border border-amber/50 bg-amber/15 text-amber"
        title="Signature recovered locally — matches receipt.agent"
      >
        <ShieldCheck className="w-2.5 h-2.5" /> Verified
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-sm border border-border/60 bg-card text-muted-foreground"
      title="Receipt is recorded on-chain; signature not yet recovered in this session"
    >
      <Hash className="w-2.5 h-2.5" /> On-chain
    </span>
  );
}

function KV({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
  hint?: string;
}) {
  const color =
    tone === "ok" ? "text-amber" : tone === "warn" ? "text-destructive" : "text-chalk/80";
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`${color} text-right break-all`} title={hint}>
        {value}
      </span>
    </div>
  );
}

// ---------- IPFS JSON fetch ----------

function useIpfsJson(cid: string | undefined) {
  return useQuery({
    queryKey: ["velo:ipfs-json", cid],
    enabled: !!cid && !cid.startsWith("local:"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      if (!cid) return null;
      const url = ipfsGatewayUrl(cid);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ipfs ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json") || ct.includes("text/json")) return res.json();
      // Try to parse anyway — Pinata sometimes serves application/octet-stream
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  });
}

