import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import {
  decodeFunctionData,
  hashTypedData,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import {
  Check,
  X,
  ShieldCheck,
  ShieldAlert,
  Clock,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Hash,
  Database,
  Cpu,
  Zap,
} from "lucide-react";
import { AgentStatusBadge } from "@/components/AgentStatusBadge";
import { orchestratorAddress } from "@/hooks/useVeloContracts";
import { explorerTx, shortAddr } from "@/lib/format";
import {
  toStrokeReport,
  toPrescriptionPlan,
  type StrokeReport,
  type PrescriptionPlan,
} from "@/lib/domain/tennis";
import { cleanFallbackReason } from "@/lib/domain/fallback";
import {
  verifyReceipt,
  domainFor,
  RECEIPT_TYPES,
  type ReceiptStruct,
} from "@/lib/web3/eip712";
import { ipfsGatewayUrl } from "@/lib/web3/uploader";
import { useIpfsJson } from "@/lib/web3/ipfs";
import { type IndexedEntry, type AiProvenance } from "@/lib/web3/indexer";
import { somniaTestnet } from "@/lib/web3/chain";
import { veloOrchestratorAbi } from "@/lib/web3/abis";
import { getRecentLogs } from "@/lib/web3/logs";
import type { AbiEvent } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000";

export type ReceiptKind = "form" | "rx";

export type DecodedReceipt = ReceiptStruct;

export function decodeReceipt(raw: unknown): DecodedReceipt | null {
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

// ---------- Layout primitives ----------

export function Stage({
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

export function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "danger";
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-chalk/50 shrink-0">{label}</span>
      <span
        className={`min-w-0 text-right break-all ${
          tone === "danger" ? "text-destructive" : tone === "amber" ? "text-amber" : "text-chalk/80"
        }`}
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

// ---------- Form / prescription report views ----------

export function FormReportView({
  report,
  summary,
}: {
  report: StrokeReport;
  summary: string;
}) {
  return (
    <>
      <h3 className="font-serif-display text-2xl text-chalk mb-1">{report.stroke}</h3>
      <p className="text-sm text-amber mb-4">{report.sessionGoal}</p>
      <SummaryBlock label="Form agent summary" text={summary} />
      {report.strengths.length > 0 && (
        <Section title="Strengths">
          <ul className="space-y-2">
            {report.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-chalk/90">
                <Check className="w-4 h-4 text-amber shrink-0 mt-0.5" />
                <span className="leading-relaxed">{s}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {report.faults.length > 0 && (
        <Section title="Faults">
          <ul className="space-y-3">
            {report.faults.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <X className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-chalk block mb-0.5">{f.area}</span>
                  <span className="text-muted-foreground leading-relaxed">{f.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {report.metrics.length > 0 && (
        <Section title="Metrics">
          <div className="grid grid-cols-2 gap-4">
            {report.metrics.map((m, i) => (
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
}

export function PrescriptionReportView({
  plan,
  summary,
}: {
  plan: PrescriptionPlan;
  summary: string;
}) {
  return (
    <>
      <h3 className="font-serif-display text-2xl text-chalk mb-1">{plan.headline}</h3>
      <p className="text-sm text-amber mb-4">{plan.sessionGoal}</p>
      <SummaryBlock label="Prescription agent summary" text={summary} />
      {plan.technicalFocus.length > 0 && (
        <div className="bg-background border-l-2 border-amber pl-4 py-2 mb-4">
          <h4 className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">
            Technical Focus
          </h4>
          <div className="space-y-4">
            {plan.technicalFocus.map((t, i) => (
              <div key={i}>
                <div className="font-medium text-chalk mb-1">
                  {t.drill}
                  {t.reps && (
                    <span className="text-muted-foreground font-mono text-xs ml-2">{t.reps}</span>
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
      {plan.warmUp.length > 0 && (
        <Section title="Warm Up">
          <ul className="list-disc list-inside space-y-1 text-sm text-chalk/80 ml-4">
            {plan.warmUp.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Section>
      )}
      {plan.conditioning.length > 0 && (
        <Section title="Conditioning">
          <ul className="list-disc list-inside space-y-1 text-sm text-chalk/80 ml-4">
            {plan.conditioning.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// ---------- Receipt stage with IPFS + verifier ----------

export function ReceiptStage({
  kind,
  jobId,
  receipt,
  indexedEntry,
  placeholderTitle,
  placeholderHint,
}: {
  kind: ReceiptKind;
  jobId: Hex;
  receipt: DecodedReceipt | null;
  indexedEntry: IndexedEntry | null;
  placeholderTitle: string;
  placeholderHint: string;
}) {
  const ipfsQuery = useIpfsJson(receipt?.ipfsCid);
  const [verifyState, setVerifyState] = useState<VerifyState>({ phase: "idle" });
  const verifiedOk = verifyState.phase === "verified" && verifyState.ok;
  const ipfs = ipfsQuery.data ?? null;

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
            <p className="font-serif-display text-lg text-chalk/60 mb-2">{placeholderTitle}</p>
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

            {kind === "form" ? (
              <FormReportView
                report={toStrokeReport(ipfs ?? {}, receipt.summary)}
                summary={receipt.summary}
              />
            ) : (
              <PrescriptionReportView
                plan={toPrescriptionPlan(ipfs ?? {}, receipt.summary)}
                summary={receipt.summary}
              />
            )}

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
        isNative ? "border-amber/30 bg-amber/[0.04]" : "border-border/50 bg-background/40"
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
            Reasoned on Somnia's Agentic L1 by the native LLM Inference agent and verified by
            validator consensus.
          </p>
          <div className="space-y-1.5 text-[11px] font-mono">
            {somnia?.requestId && <Row label="Request ID" value={somnia.requestId} />}
            {somnia?.agentId && <Row label="Agent ID" value={somnia.agentId} />}
            {somnia?.consensusStatus && (
              <Row label="Consensus" value={somnia.consensusStatus} tone="amber" />
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {somnia?.txHash && (
              <a
                href={explorerTx(somnia.txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-mono text-amber hover:text-amber-soft"
              >
                View on Somnia explorer <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {somnia?.receiptUrl && (
              <a
                href={somnia.receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-mono text-amber hover:text-amber-soft"
              >
                View consensus receipt <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed break-words">
          Somnia native agents were unavailable, so this verdict was produced by the off-chain
          fallback model.
          {(() => {
            const reason = cleanFallbackReason(provenance.fallbackReason);
            return reason ? ` (${reason})` : "";
          })()}
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
        const eventName = kind === "form" ? "FormReceiptSubmitted" : "PrescriptionSubmitted";
        const event = veloOrchestratorAbi.find(
          (x) => x.type === "event" && x.name === eventName,
        );
        if (!event) {
          setState({ phase: "no-sig", reason: "Event ABI missing" });
          return;
        }
        // Somnia caps `eth_getLogs` at 1000-block windows; scan a bounded recent
        // window (the indexer signature is the fast path — this only runs when it
        // isn't available). A miss here means "not found in the recent window",
        // surfaced clearly rather than as a silent empty.
        const logs = (await getRecentLogs(client, {
          address: orch,
          event: event as AbiEvent,
          args: { jobId },
        })) as Array<{ transactionHash: Hex | null }>;
        if (logs.length === 0) {
          setState({
            phase: "no-sig",
            reason: "No recent submission log on chain",
          });
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
        const fnName = kind === "form" ? "submitFormReceipt" : "submitPrescription";
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
        <KV label="Stored summaryHash" value={receipt.summaryHash} />
        <KV
          label="Local keccak256(summary)"
          value={summaryHashLocal ?? "—"}
          tone={summaryHashMatch ? "ok" : "warn"}
          hint={summaryHashMatch ? "matches on-chain digest" : "does not match — summary may be off"}
        />
        <KV label="EIP-712 digest" value={digest ?? "—"} />
        {indexedEntry && (
          <>
            <KV label="ipfsCid" value={receipt.ipfsCid} />
            <KV label="Submission tx" value={indexedEntry.txHash} />
            <KV label="Submission block" value={indexedEntry.blockNumber.toString()} />
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
