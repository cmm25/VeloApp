import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSignMessage } from "wagmi";
import { TopBar } from "@/components/TopBar";
import { AthleteMonogram } from "@/components/AthleteMonogram";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { AgentStatusBadge } from "@/components/AgentStatusBadge";
import { IndexerSourceBadge } from "@/components/IndexerSourceBadge";
import {
  useAthleteReceipts,
  useTokenUri,
  useJob,
  decodeTokenUri,
  orchestratorAddress,
  sbtAddress,
  type SbtReceiptRef,
} from "@/hooks/useVeloContracts";
import { veloOrchestratorAbi, athleteSbtAbi } from "@/lib/web3/abis";
import { somniaTestnet } from "@/lib/web3/chain";
import { useAthleteDirectory } from "@/lib/domain/athletes";
import {
  useTapes,
  useAddTape,
  useRemoveTape,
  formatTapeSize,
  formatTapeDate,
  defaultLabelFor,
  type Tape,
} from "@/lib/domain/tapes";
import { shortAddr, shortHash } from "@/lib/format";
import { ipfsGatewayUrl, uploadVideo } from "@/lib/web3/uploader";
import { useIpfsJson, summaryFromReport, somniaReceiptUrlFromJson } from "@/lib/web3/ipfs";
import { InsightBar } from "@/components/InsightBar";
import {
  useMyCoaches,
  useMyRosterRequests,
  useAcceptRosterRequest,
  useDeclineRosterRequest,
} from "@/lib/domain/roster";
import {
  ExternalLink,
  ShieldCheck,
  FileText,
  Award,
  Pencil,
  Check,
  Loader2,
  Upload,
  Trash2,
  Copy,
  Link as LinkIcon,
  Film,
  Plus,
} from "lucide-react";
import { Link } from "wouter";
import { EmptyState } from "@/components/ui/states";
import { motion } from "framer-motion";
import { toast } from "sonner";

/** How long the receipt list keeps polling after the last relevant on-chain
 * event before it backs off (mirrors `useJob` settling into a terminal state). */
const RECEIPT_LIVE_WINDOW_MS = 60_000;

export default function AthleteHome() {
  const { address } = useAccount();
  // Auto-refresh the receipt list while a session targeting this athlete is in
  // flight. We open a live window when the athlete's job is requested or a new
  // receipt is appended, then back off after a quiet spell so an idle page is
  // not polling forever.
  const receiptsLive = useReceiptsLive(address);
  const { receipts, count, tokenId, isLoading } = useAthleteReceipts(address, {
    poll: receiptsLive,
  });
  const { data: tokenUriRaw } = useTokenUri(tokenId);
  const metadata = decodeTokenUri(tokenUriRaw as string | undefined);
  const { resolve, ensure, claim } = useAthleteDirectory();
  const { signMessageAsync } = useSignMessage();
  const tapesQ = useTapes(address);
  const addTape = useAddTape();
  const libraryCids = new Set(
    (tapesQ.data ?? []).map((t) => t.cid.trim().toLowerCase()),
  );

  useEffect(() => {
    if (address) ensure(address);
  }, [address, ensure]);

  const me = address ? resolve(address) : null;
  const isPlaceholder = me?.name.startsWith("Athlete ") ?? false;
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    if (me) setNameDraft(me.name);
  }, [me?.name]);

  const saveName = async () => {
    if (!address) return;
    const n = nameDraft.trim();
    if (!n) return;
    setClaimError(null);
    setClaiming(true);
    const result = await claim(n, address, (msg) => signMessageAsync({ message: msg }));
    setClaiming(false);
    if (!result.ok) {
      setClaimError(result.error);
      return;
    }
    setEditing(false);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-amber/30 selection:text-amber">
      <TopBar />

      <main className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-12 pb-24">
        <header className="mb-12 border-b border-border/50 pb-10">
          <div className="flex flex-col md:flex-row md:items-center gap-6 mb-6">
            {me && <AthleteMonogram name={me.name} size="xl" />}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-2">
                Permanent record
              </div>
              {editing ? (
                <div className="max-w-md">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      placeholder="Your name"
                      disabled={claiming}
                      className="flex-1 bg-input border border-amber/50 focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk text-2xl font-serif-display disabled:opacity-60"
                      autoFocus
                    />
                    <button
                      onClick={saveName}
                      disabled={claiming || !nameDraft.trim()}
                      className="bg-amber hover:bg-amber-soft disabled:opacity-50 disabled:hover:bg-amber text-ink p-2 rounded-sm"
                      title="Sign & save"
                    >
                      {claiming ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mt-2">
                    {claiming
                      ? "Open your wallet to sign the claim…"
                      : "Saving requires a wallet signature to prove this address is yours."}
                  </p>
                  {claimError && (
                    <p className="text-[11px] text-red-400 mt-1 break-words">
                      Claim failed: {claimError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="font-serif-display text-4xl md:text-6xl text-chalk tracking-tight leading-tight">
                    {me?.name ?? "Athlete"}
                  </h1>
                  {me && !isPlaceholder && <VerifiedBadge verified={me.verified} size="md" />}
                  <button
                    onClick={() => {
                      setClaimError(null);
                      setEditing(true);
                    }}
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-muted-foreground hover:text-amber border border-border/50 hover:border-amber/40 px-2 py-1 rounded-sm transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    {isPlaceholder || !me?.verified ? "Claim your name" : "Edit"}
                  </button>
                </div>
              )}
              {address && (
                <div className="font-mono text-[10px] text-muted-foreground mt-2 truncate">
                  {address}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 items-center">
            <Stat label="SBT ID" value={tokenId.toString()} />
            <Stat label="Receipts" value={String(count)} />
            {address && (
              <Link
                href={`/p/${address}`}
                className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-amber hover:text-amber-soft border border-amber/40 hover:border-amber px-3 py-2 rounded-sm transition-colors"
              >
                <LinkIcon className="w-3 h-3" />
                View public profile
              </Link>
            )}
          </div>
        </header>

        {address && <PendingRequestsSection address={address} />}

        {address && <CoachesSection address={address} />}

        {address && <TapeLibrarySection address={address} />}

        {metadata && (
          <section className="mb-12 p-6 bg-card/30 border border-border/50 rounded-sm">
            <div className="flex items-center gap-2 mb-4">
              <Award className="w-4 h-4 text-amber" />
              <h2 className="text-xs uppercase tracking-widest font-bold text-muted-foreground">
                SBT metadata (tokenURI)
              </h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              {typeof metadata.name === "string" && (
                <Field label="Name" value={metadata.name} />
              )}
              {typeof metadata.description === "string" && (
                <Field label="Description" value={metadata.description} />
              )}
              {Array.isArray((metadata as any).attributes) &&
                ((metadata as any).attributes as Array<{ trait_type?: string; value?: unknown }>)
                  // Drop malformed entries so we never render "attr 0" / "—".
                  .filter(
                    (a) =>
                      typeof a?.trait_type === "string" &&
                      a.trait_type.trim() &&
                      a.value != null &&
                      String(a.value).trim(),
                  )
                  .map((a, i) => (
                    <Field key={i} label={a.trait_type!} value={String(a.value)} />
                  ))}
            </div>
          </section>
        )}

        <InsightBar address={address} />

        <section>
          <div className="flex items-center justify-between gap-3 mb-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Receipts · {receipts.length}
            </h3>
            <IndexerSourceBadge source="rpc" />
          </div>
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
            <div className="space-y-6">
              {receipts.map((r, i) => (
                <ReceiptRow
                  key={r.jobId}
                  r={r}
                  index={i}
                  libraryCids={libraryCids}
                  onClaim={async (cid) => {
                    try {
                      await addTape.mutateAsync({
                        cid,
                        label: `From session ${shortAddr(r.jobId, 6, 4)}`,
                      });
                      toast.success("Tape added to your library");
                    } catch (err) {
                      toast.error("Couldn't add tape", {
                        description: err instanceof Error ? err.message : String(err),
                      });
                    }
                  }}
                  claimingCid={
                    addTape.isPending ? (addTape.variables?.cid ?? null) : null
                  }
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// Pending roster requests

function PendingRequestsSection({ address }: { address: `0x${string}` }) {
  const q = useMyRosterRequests(!!address);
  const accept = useAcceptRosterRequest();
  const decline = useDeclineRosterRequest();
  const requests = q.data ?? [];
  if (requests.length === 0) return null;
  return (
    <section className="mb-12">
      <h2 className="text-xs font-bold uppercase tracking-widest text-amber mb-4">
        Coach requests · {requests.length}
      </h2>
      <ul className="border border-amber/30 bg-amber/[0.03] rounded-sm divide-y divide-border/30">
        {requests.map((r) => {
          const label = r.coachName ?? `Coach ${shortAddr(r.coachAddress, 6, 4)}`;
          return (
            <li key={r.id} className="flex items-center gap-4 px-4 py-3">
              <AthleteMonogram name={label} size="md" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-chalk truncate font-medium">{label}</div>
                <div className="font-mono text-[10px] text-muted-foreground truncate">
                  wants to add you · {shortAddr(r.coachAddress, 6, 4)} ·{" "}
                  {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() =>
                  decline.mutate(r.id, {
                    onSuccess: () => toast.success("Declined"),
                    onError: (err) =>
                      toast.error("Decline failed", {
                        description: err instanceof Error ? err.message : String(err),
                      }),
                  })
                }
                disabled={decline.isPending || accept.isPending}
                className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground hover:text-destructive px-2 py-1 border border-border/50 hover:border-destructive/40 rounded-sm transition-colors disabled:opacity-50"
              >
                Decline
              </button>
              <button
                onClick={() =>
                  accept.mutate(r.id, {
                    onSuccess: () => toast.success(`${label} added`),
                    onError: (err) =>
                      toast.error("Accept failed", {
                        description: err instanceof Error ? err.message : String(err),
                      }),
                  })
                }
                disabled={accept.isPending || decline.isPending}
                className="text-[10px] uppercase tracking-widest font-bold text-ink bg-amber hover:bg-amber-soft px-3 py-1 rounded-sm transition-colors disabled:opacity-50"
              >
                Accept
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Coaches section

function CoachesSection({ address }: { address: `0x${string}` }) {
  const q = useMyCoaches(!!address);
  const coaches = q.data ?? [];
  if (q.isLoading) {
    return (
      <section className="mb-12">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
          Your coaches
        </h2>
        <div className="h-16 bg-card/50 border border-border/50 rounded-sm animate-pulse" />
      </section>
    );
  }
  if (coaches.length === 0) return null;
  return (
    <section className="mb-12">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
        Your coaches · {coaches.length}
      </h2>
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {coaches.map((c) => {
          const label = c.coachName ?? `Coach ${shortAddr(c.coachAddress, 6, 4)}`;
          return (
            <li key={c.coachAddress} className="shrink-0">
              <div className="flex items-center gap-3 px-4 py-3 bg-card/40 border border-border/50 rounded-sm w-64">
                <AthleteMonogram name={label} size="md" />
                <div className="min-w-0">
                  <div className="text-sm text-chalk truncate font-medium">{label}</div>
                  <div className="font-mono text-[10px] text-muted-foreground truncate">
                    {shortAddr(c.coachAddress, 6, 4)} · since{" "}
                    {new Date(c.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Tape library section

function TapeLibrarySection({ address }: { address: `0x${string}` }) {
  const tapesQ = useTapes(address);
  const addTape = useAddTape();
  const removeTape = useRemoveTape();
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const ingest = async (f: File) => {
    if (!f.type.startsWith("video/")) {
      toast.error("That doesn't look like a video file");
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const res = await uploadVideo(f, (pct) => setProgress(pct));
      await addTape.mutateAsync({
        cid: res.cid,
        label: defaultLabelFor(f.name),
        sizeBytes: res.size,
        contentType: f.type,
      });
      toast.success(res.demo ? "Tape added (demo mode)" : "Tape pinned to IPFS");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Tape upload failed", { description: msg });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploading) return;
    const f = e.dataTransfer.files?.[0];
    if (f) void ingest(f);
  };

  const tapes = tapesQ.data ?? [];

  return (
    <section className="mb-12">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Your library{tapes.length > 0 ? ` · ${tapes.length}` : ""}
        </h2>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`block w-full border-2 border-dashed rounded-sm p-6 text-center cursor-pointer transition-all mb-4 ${
          isDragging
            ? "border-amber bg-amber/10"
            : "border-border/50 hover:border-amber/50 bg-card/30 hover:bg-card/60"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void ingest(f);
          }}
        />
        <Upload
          className={`w-6 h-6 mx-auto mb-2 transition-colors ${
            isDragging ? "text-amber" : "text-muted-foreground"
          }`}
        />
        <p className="text-sm text-chalk font-medium mb-1">
          {uploading
            ? `Pinning to IPFS… ${progress}%`
            : isDragging
              ? "Drop to add to library"
              : "Drop a video here, or click to add a tape"}
        </p>
        <p className="text-xs text-muted-foreground font-light">
          MP4 / MOV / WEBM up to 200&nbsp;MB · stored on IPFS, free to add
        </p>
        {uploading && (
          <div className="h-1 bg-border rounded-full overflow-hidden mt-3 max-w-sm mx-auto">
            <div
              className="h-full bg-amber transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </label>

      {tapesQ.isLoading ? (
        <div className="grid sm:grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-24 bg-card/50 border border-border/50 rounded-sm animate-pulse"
            />
          ))}
        </div>
      ) : tapes.length > 0 ? (
        <ul className="grid sm:grid-cols-2 gap-3">
          {tapes.map((t) => (
            <TapeRow
              key={t.id}
              tape={t}
              onRemove={() =>
                removeTape.mutate(
                  { id: t.id, address },
                  {
                    onSuccess: () => toast.success("Tape removed"),
                    onError: (err) =>
                      toast.error("Remove failed", {
                        description: err instanceof Error ? err.message : String(err),
                      }),
                  },
                )
              }
              removing={removeTape.isPending && removeTape.variables?.id === t.id}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground font-light">
          No tapes in your library yet. Drop one above — coaches will be able to pick it
          from your collection.
        </p>
      )}
    </section>
  );
}

function TapeRow({
  tape,
  onRemove,
  removing,
}: {
  tape: Tape;
  onRemove: () => void;
  removing: boolean;
}) {
  const isLocal = tape.cid.startsWith("local:");
  return (
    <li className="p-3 bg-card/40 border border-border/50 rounded-sm flex items-center gap-3 group">
      <div className="w-10 h-10 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
        <Film className="w-4 h-4 text-amber/80" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-chalk truncate">{tape.label ?? "Untitled tape"}</div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground truncate">
          <span>{formatTapeDate(tape.createdAt)}</span>
          <span className="text-border">·</span>
          <span>{formatTapeSize(tape.sizeBytes)}</span>
          <span className="text-border">·</span>
          <span className="truncate">{shortAddr(tape.cid, 6, 6)}</span>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(tape.cid).then(() => toast.success("CID copied"));
            }}
            className="text-muted-foreground hover:text-amber"
            title="Copy CID"
          >
            <Copy className="w-3 h-3" />
          </button>
          {!isLocal && (
            <a
              href={ipfsGatewayUrl(tape.cid)}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-amber"
              title="Open on IPFS"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
      <button
        onClick={onRemove}
        disabled={removing}
        className="text-muted-foreground hover:text-destructive disabled:opacity-40 p-1"
        title="Remove tape"
      >
        {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </button>
    </li>
  );
}

// Receipt row

function ReceiptRow({
  r,
  index,
  libraryCids,
  onClaim,
  claimingCid,
}: {
  r: SbtReceiptRef;
  index: number;
  libraryCids: Set<string>;
  onClaim: (cid: string) => void | Promise<void>;
  claimingCid: string | null;
}) {
  const { data: ipfs, isLoading: ipfsLoading } = useIpfsJson(r.ipfsCid);
  const summary = summaryFromReport(ipfs);
  const somniaReceiptUrl = somniaReceiptUrlFromJson(ipfs);
  // Live-poll on-chain state so an in-flight session advances (Form ->
  // Prescriber -> Appended) without a manual reload. `useJob` stops polling on
  // its own once the job reaches a terminal state (Completed/Cancelled),
  // mirroring the coach's Job Detail view.
  const { data: job } = useJob(r.jobId, { poll: true });
  const videoCid = job?.videoCid?.trim() ?? "";
  const isDemoCid = videoCid.startsWith("local:");
  const inLibrary = videoCid ? libraryCids.has(videoCid.toLowerCase()) : true;
  const showClaim = !!videoCid && !isDemoCid && !inLibrary;
  const isClaimingThis = claimingCid === videoCid;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group p-6 bg-card/30 hover:bg-card border border-border/50 hover:border-amber/30 transition-all rounded-sm relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-amber/5 blur-3xl rounded-full group-hover:bg-amber/10 transition-colors -mr-16 -mt-16 pointer-events-none" />

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
        <div className="space-y-4 flex-1">
          <div className="flex items-center gap-3">
            <span className="font-mono text-amber text-sm">
              {new Date(Number(r.timestamp) * 1000).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="text-border text-sm">•</span>
            <span className="font-mono text-xs text-muted-foreground">
              Session {shortAddr(r.jobId, 6, 4)}
            </span>
          </div>

          <div className="grid md:grid-cols-2 gap-4 bg-background/50 p-4 border border-border/50 rounded-sm">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Form agent
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs text-chalk/80">
                <ShieldCheck className="w-3.5 h-3.5 text-amber/70" />
                {shortAddr(r.formAgent)}
              </div>
              <AgentStatusBadge agent={r.formAgent} />
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Prescription agent
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs text-chalk/80">
                <ShieldCheck className="w-3.5 h-3.5 text-amber/70" />
                {shortAddr(r.prescriptionAgent)}
              </div>
              <AgentStatusBadge agent={r.prescriptionAgent} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:items-end">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Summary Hash
            </div>
            <div className="font-mono text-xs text-chalk/60 bg-background px-2 py-1 rounded-sm border border-border/50">
              {shortHash(r.summaryHash)}
            </div>
          </div>

          {(somniaReceiptUrl || (r.ipfsCid && !r.ipfsCid.startsWith("local:"))) && (
            <a
              href={somniaReceiptUrl ?? ipfsGatewayUrl(r.ipfsCid)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-amber hover:text-amber-soft transition-colors"
            >
              {somniaReceiptUrl ? "Somnia Receipt" : "View Raw JSON"} <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/40">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
          Coach summary
        </div>
        {r.ipfsCid.startsWith("local:") ? (
          <p className="text-sm text-muted-foreground font-light">
            Local-only receipt (demo CID).
          </p>
        ) : ipfsLoading ? (
          <div className="h-4 w-2/3 bg-border/40 rounded-sm animate-pulse" />
        ) : summary ? (
          <p className="text-sm text-chalk/90 leading-relaxed">{summary}</p>
        ) : (
          <p className="text-xs text-muted-foreground font-light">
            Receipt JSON did not include a readable summary.
          </p>
        )}
      </div>

      {showClaim && (
        <div className="mt-4 pt-4 border-t border-border/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
              Tape not in your library
            </div>
            <div className="text-xs text-chalk/80 font-light">
              Your coach analyzed{" "}
              <span className="font-mono text-amber/80">{shortAddr(videoCid, 6, 6)}</span>
              . Add it so future coaches can pick the same tape.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClaim(videoCid)}
            disabled={isClaimingThis}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-ink bg-amber hover:bg-amber-soft disabled:opacity-60 px-3 py-2 rounded-sm transition-colors shrink-0"
          >
            {isClaimingThis ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                Add this tape to my library
              </>
            )}
          </button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Returns `true` while the athlete's receipt list should auto-refresh.
 *
 * The athlete page has no in-flight job list of its own, so we watch the
 * on-chain events that bracket a session for this athlete — `JobRequested`
 * (session opened) on the orchestrator and `ReceiptAppended` (receipt landed)
 * on the SBT, both indexed by athlete. Either one opens a live window; the
 * window closes after a quiet spell so an idle page stops polling, mirroring
 * how `useJob` stops at a terminal state.
 */
function useReceiptsLive(athlete?: `0x${string}`): boolean {
  const [live, setLive] = useState(false);
  const orch = orchestratorAddress();
  const sbt = sbtAddress();
  const client = usePublicClient({ chainId: somniaTestnet.id });

  useEffect(() => {
    if (!athlete || !client) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const openWindow = () => {
      setLive(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setLive(false), RECEIPT_LIVE_WINDOW_MS);
    };
    const unsubs: Array<() => void> = [];
    if (orch) {
      unsubs.push(
        client.watchContractEvent({
          address: orch,
          abi: veloOrchestratorAbi,
          eventName: "JobRequested",
          args: { athlete } as never,
          onLogs: () => openWindow(),
        }),
      );
    }
    if (sbt) {
      unsubs.push(
        client.watchContractEvent({
          address: sbt,
          abi: athleteSbtAbi,
          eventName: "ReceiptAppended",
          args: { athlete } as never,
          onLogs: () => openWindow(),
        }),
      );
    }
    return () => {
      if (timer) clearTimeout(timer);
      unsubs.forEach((u) => u());
    };
  }, [athlete, orch, sbt, client]);

  return live;
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </div>
      <div className="text-chalk/90 break-words">{value}</div>
    </div>
  );
}
