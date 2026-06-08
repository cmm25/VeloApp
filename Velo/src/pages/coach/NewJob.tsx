import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  isAddress,
  parseEther,
  formatEther,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import { TopBar } from "@/components/TopBar";
import { AthleteMonogram } from "@/components/AthleteMonogram";
import { MiniProfileCard } from "@/components/MiniProfileCard";
import { useMinJobFee, orchestratorAddress } from "@/hooks/useVeloContracts";
import {
  usePostBounty,
  useMinBountyFee,
  parseSttToWei,
} from "@/lib/domain/bounties";
import {
  useRegisteredAgents,
  skillLabel,
  isVisionSkill,
  catalogVisionSkills,
} from "@/lib/domain/agents";
import { encodeJobSpec, skillHashOf } from "@/lib/domain/jobSpec";
import { useAthleteDirectory, type Athlete } from "@/lib/domain/athletes";
import {
  useTapes,
  formatTapeSize,
  formatTapeDate,
  defaultLabelFor,
  type Tape,
} from "@/lib/domain/tapes";
import { uploadVideo, ipfsGatewayUrl } from "@/lib/web3/uploader";
import { veloOrchestratorAbi } from "@/lib/web3/abis";
import { somniaTestnet } from "@/lib/web3/chain";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { recordRecentJob } from "@/lib/domain/recentJobs";
import { formatStt, shortAddr } from "@/lib/format";
import {
  Upload,
  Film,
  CheckCircle2,
  ArrowRight,
  ExternalLink,
  Copy,
  UserPlus,
  Search,
  X,
  ArrowLeft,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

type SuccessState = {
  txHash: Hex;
  jobId: Hex | null;
  cid: string;
  isDemoCid: boolean;
};

const DEADLINE_HOURS = 24;

// Default analysis model for direct jobs. Picking this passes the raw videoCid
// through unchanged (no off-chain routing prefix), so legacy/default jobs are
// byte-for-byte identical and the Form agent picks them up as before.
const DEFAULT_MODEL_SKILL = skillHashOf("vision.pose");

export default function NewJob() {
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const { address: coachAddr } = useAccount();
  const { data: minFee } = useMinJobFee();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: somniaTestnet.id });
  const { list, search, upsert, ensure, resolve } = useAthleteDirectory();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selected, setSelected] = useState<Athlete | null>(null);
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const [pickedCid, setPickedCid] = useState<string>("");
  const [pickedLabel, setPickedLabel] = useState<string>("");
  const [pickedSource, setPickedSource] = useState<"library" | "upload" | null>(null);
  const [isDemoCid, setIsDemoCid] = useState(false);

  const [_uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [feeInput, setFeeInput] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  // Direct-mode analysis model selection. Defaults to the pose/Form model, which
  // sends the raw cid unchanged (see DEFAULT_MODEL_SKILL).
  const [selectedModel, setSelectedModel] = useState<Hex>(DEFAULT_MODEL_SKILL);

  // Direct-mode deadline (hours from now); coach-editable like the bounty flow.
  const [directDeadlineHours, setDirectDeadlineHours] = useState<number>(DEADLINE_HOURS);

  // Bounty mode
  const [mode, setMode] = useState<"direct" | "bounty">("bounty");
  const [bountyBudget, setBountyBudget] = useState<string>("");
  const [bountyDeadlineHours, setBountyDeadlineHours] = useState<number>(48);
  const [bountySkills, setBountySkills] = useState<Set<string>>(new Set());
  const { agents: registeredAgents } = useRegisteredAgents();
  const { data: minBountyFee } = useMinBountyFee();
  const { postBounty, isPending: postingBounty } = usePostBounty();

  const allBountySkills = useMemo(() => {
    const set = new Set<string>();
    registeredAgents.forEach((a) =>
      a.skills.forEach((s) => set.add(s.toLowerCase())),
    );
    return Array.from(set) as Hex[];
  }, [registeredAgents]);

  // Vision models a coach can route a DIRECT job to. Seeded with the known model
  // catalog (the default pose model + the Serve model, etc.) so a coach can
  // always choose; any other registered "vision.*" agent skill is merged in so
  // newly deployed analysis models appear automatically.
  const visionModels = useMemo(() => {
    const set = new Set<string>([
      DEFAULT_MODEL_SKILL.toLowerCase(),
      ...catalogVisionSkills().map((s) => s.toLowerCase()),
    ]);
    registeredAgents.forEach((a) =>
      a.skills.forEach((s) => {
        if (isVisionSkill(s)) set.add(s.toLowerCase());
      }),
    );
    return Array.from(set) as Hex[];
  }, [registeredAgents]);

  const toggleBountySkill = (s: Hex) => {
    const next = new Set(bountySkills);
    const key = s.toLowerCase();
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setBountySkills(next);
  };

  const handlePostBounty = async () => {
    if (!selected) {
      toast.error("Pick an athlete first");
      return;
    }
    if (!pickedCid) {
      toast.error("Pick or upload a tape first");
      return;
    }
    let valueWei: bigint;
    try {
      valueWei = parseSttToWei(bountyBudget || "0");
    } catch {
      toast.error("Invalid budget amount");
      return;
    }
    if (minBountyFee && valueWei < (minBountyFee as bigint)) {
      toast.error(`Budget must be at least ${formatStt(minBountyFee as bigint)}`);
      return;
    }
    if (bountyDeadlineHours <= 0) {
      toast.error("Deadline must be in the future");
      return;
    }
    setIsSubmitting(true);
    try {
      const deadline = BigInt(
        Math.floor(Date.now() / 1000) + bountyDeadlineHours * 3600,
      );
      const skills = Array.from(bountySkills) as Hex[];
      const txHash = await postBounty({
        athlete: selected.address,
        videoCid: pickedCid,
        deadline,
        requiredSkills: skills,
        valueWei,
      });
      toast.loading("Confirming on-chain…", { id: "bounty-confirm" });
      if (client) {
        await client.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
      }
      toast.success("Bounty posted", {
        id: "bounty-confirm",
        description: `${txHash.slice(0, 10)}…${txHash.slice(-6)}`,
      });
      setLocation("/bounties");
    } catch (err: any) {
      console.error(err);
      toast.error("Post failed", {
        description: err?.shortMessage || err?.message || "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (minFee && feeInput === "") setFeeInput(formatEther(minFee));
  }, [minFee, feeInput]);

  // Prefill athlete from ?athlete=0x.. query param (deep-link from roster).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    const params = new URLSearchParams(searchParams);
    const raw = params.get("athlete");
    if (!raw || !isAddress(raw)) return;
    prefilled.current = true;
    const addr = raw as Address;
    const a = resolve(addr) ?? ensure(addr);
    setSelected(a);
    setQuery(a.name);
  }, [searchParams, resolve, ensure]);

  const matches = useMemo(() => search(query).slice(0, 6), [search, query]);
  const queryIsAddress = isAddress(query.trim());

  // Tape library for the picked athlete
  const tapesQ = useTapes(selected?.address);
  const tapes = tapesQ.data ?? [];

  const pick = (a: Athlete) => {
    setSelected(a);
    setQuery(a.name);
    setShowDropdown(false);
    resetTapeChoice();
  };

  const resetTapeChoice = () => {
    setPickedCid("");
    setPickedLabel("");
    setPickedSource(null);
    setIsDemoCid(false);
    setUploadFile(null);
    setUploadProgress(0);
  };

  const handlePasteAddress = () => {
    const a = query.trim();
    if (!isAddress(a)) return;
    const existing = resolve(a as Address);
    const athlete = existing ?? ensure(a as Address);
    setSelected(athlete);
    setShowDropdown(false);
    resetTapeChoice();
  };

  const openAddForm = () => {
    setAdding(true);
    setNewName(query.trim() && !queryIsAddress ? query.trim() : "");
    setNewAddr(queryIsAddress ? query.trim() : "");
  };

  const handleSaveNew = () => {
    const nm = newName.trim();
    const ad = newAddr.trim();
    if (!nm) {
      toast.error("Enter a name");
      return;
    }
    if (!isAddress(ad)) {
      toast.error("Invalid Ethereum address");
      return;
    }
    upsert(nm, ad as Address);
    const a: Athlete = {
      name: nm,
      address: ad as Address,
      initials: nm[0].toUpperCase(),
      verified: false,
    };
    setSelected(a);
    setQuery(nm);
    setAdding(false);
    setShowDropdown(false);
    resetTapeChoice();
    toast.success(`${nm} added`);
  };

  const handlePickTape = (t: Tape) => {
    setPickedCid(t.cid);
    setPickedLabel(t.label ?? "Tape");
    setPickedSource("library");
    setIsDemoCid(t.cid.startsWith("local:"));
  };

  const ingestUpload = async (f: File) => {
    if (!selected) {
      toast.error("Pick an athlete first");
      return;
    }
    if (!f.type.startsWith("video/")) {
      toast.error("That doesn't look like a video file");
      return;
    }
    setUploadFile(f);
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const res = await uploadVideo(f, (pct) => setUploadProgress(pct));
      setPickedCid(res.cid);
      setPickedLabel(defaultLabelFor(f.name));
      setPickedSource("upload");
      setIsDemoCid(res.demo);
      // Intentionally NOT persisted to the athlete's library: the tape is
      // owned by the athlete, and the /tapes write surface only accepts a
      // tape from the wallet that signs the SIWE session. The coach can
      // still pay against this CID for this one job (the contract only
      // stores the raw videoCid string); the athlete can claim the tape
      // into their library afterwards from their dashboard if they want.
    } catch (err) {
      console.error(err);
      toast.error("Upload failed");
      setUploadFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    const f = e.dataTransfer.files?.[0];
    if (f) void ingestUpload(f);
  };

  const handlePay = async () => {
    if (!selected) {
      toast.error("Pick an athlete first");
      return;
    }
    if (!pickedCid) {
      toast.error("Pick or upload a tape first");
      return;
    }
    const orch = orchestratorAddress();
    if (!orch) {
      toast.error("Contract not deployed");
      return;
    }
    let valueWei: bigint;
    try {
      valueWei = parseEther(feeInput || "0");
    } catch {
      toast.error("Invalid fee amount");
      return;
    }
    if (minFee && valueWei < minFee) {
      toast.error(`Fee must be at least ${formatStt(minFee)}`);
      return;
    }
    if (directDeadlineHours <= 0) {
      toast.error("Deadline must be in the future");
      return;
    }

    setIsSubmitting(true);
    try {
      const deadline = BigInt(
        Math.floor(Date.now() / 1000) + directDeadlineHours * 3600,
      );
      // Off-chain model routing: the default (pose) model sends the raw cid; any
      // other selected vision model encodes its skill into the videoCid so the
      // matching agent self-selects the job. recordRecentJob keeps the RAW cid.
      const cidToSend =
        selectedModel.toLowerCase() === DEFAULT_MODEL_SKILL.toLowerCase()
          ? pickedCid
          : encodeJobSpec(selectedModel, pickedCid);
      const t0 = performance.now();
      const txHash = await writeContractAsync({
        address: orch,
        abi: veloOrchestratorAbi,
        functionName: "payJob",
        args: [selected.address, cidToSend, deadline],
        value: valueWei,
      });

      toast.success("Tx submitted", {
        description: `${txHash.slice(0, 10)}…${txHash.slice(-6)} · awaiting Somnia finality`,
      });

      let jobId: Hex | null = null;
      if (client) {
        try {
          const receipt = await client.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
          const ms = Math.round(performance.now() - t0);
          toast.success(`Finalized in ${ms} ms`, {
            description: `block ${receipt.blockNumber.toString()} · Somnia testnet`,
          });
          for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== orch.toLowerCase()) continue;
            try {
              const decoded = decodeEventLog({
                abi: veloOrchestratorAbi,
                data: log.data,
                topics: log.topics,
              });
              if (decoded.eventName === "JobRequested") {
                jobId = (decoded.args as { jobId: Hex }).jobId;
                break;
              }
            } catch {
              /* not this event */
            }
          }
        } catch (err) {
          console.warn("Receipt wait failed", err);
        }
      }
      if (jobId) {
        if (coachAddr) {
          recordRecentJob(coachAddr, {
            jobId,
            athlete: selected.address,
            cid: pickedCid,
            createdAt: Date.now(),
          });
        }
        setLocation(`/coach/jobs/${jobId}`);
      } else {
        setSuccess({ txHash, jobId, cid: pickedCid, isDemoCid });
        setStep(4);
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Transaction failed", {
        description: err.shortMessage || err.message || "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => toast.success("Copied"));
  };

  const goStep1 = () => setStep(1);
  const goStep2 = () => {
    if (!selected) {
      toast.error("Pick an athlete first");
      return;
    }
    setStep(2);
  };
  const goStep3 = () => {
    if (!pickedCid) {
      toast.error("Pick or upload a tape first");
      return;
    }
    setStep(3);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <TopBar />

      <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-12">
        <div className="mb-10">
          <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight mb-2">
            New session
          </h1>
          <p className="text-sm text-muted-foreground font-light">
            Pick an athlete · pick a tape from their library · set fee &amp; deadline · sign.
          </p>
          <div role="tablist" className="mt-6 inline-flex border border-border/60 rounded-sm overflow-hidden">
            <button
              role="tab"
              aria-selected={mode === "direct"}
              onClick={() => setMode("direct")}
              className={`px-4 py-2 text-[11px] uppercase tracking-widest font-bold transition-colors ${
                mode === "direct"
                  ? "bg-amber text-ink"
                  : "text-muted-foreground hover:text-chalk"
              }`}
            >
              Hire directly
            </button>
            <button
              role="tab"
              aria-selected={mode === "bounty"}
              onClick={() => setMode("bounty")}
              className={`px-4 py-2 text-[11px] uppercase tracking-widest font-bold transition-colors border-l border-border/60 ${
                mode === "bounty"
                  ? "bg-amber text-ink"
                  : "text-muted-foreground hover:text-chalk"
              }`}
            >
              Post bounty
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-10">
          {/* LEFT: wizard steps */}
          <div className="space-y-6">
            <StepHeader step={1} active={step >= 1} title="Athlete" onClick={goStep1} />
            {step === 1 ? (
              <div className="space-y-4 max-w-md">
                <div ref={wrapRef} className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={query}
                    onFocus={() => setShowDropdown(true)}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setShowDropdown(true);
                      if (selected && selected.name !== e.target.value) setSelected(null);
                    }}
                    placeholder="Search athlete by name…"
                    className="w-full bg-input border border-border focus:border-amber focus:ring-1 focus:ring-amber rounded-sm pl-9 pr-3 py-3 text-chalk text-sm transition-all"
                  />
                  {showDropdown && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-card border border-border/60 rounded-sm shadow-xl overflow-hidden">
                      {matches.length > 0 && (
                        <ul className="max-h-64 overflow-auto">
                          {matches.map((a) => (
                            <li key={a.address}>
                              <button
                                type="button"
                                onClick={() => pick(a)}
                                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-border/40 text-left transition-colors"
                              >
                                <AthleteMonogram name={a.name} size="sm" />
                                <div className="min-w-0">
                                  <div className="text-sm text-chalk truncate">{a.name}</div>
                                  <div className="font-mono text-[10px] text-muted-foreground truncate">
                                    {shortAddr(a.address, 6, 4)}
                                  </div>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="border-t border-border/60 bg-background/50">
                        {queryIsAddress && (
                          <button
                            type="button"
                            onClick={handlePasteAddress}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-border/40 text-xs text-chalk/80"
                          >
                            <ArrowRight className="w-3 h-3 text-amber" />
                            Use pasted address{" "}
                            <span className="font-mono text-muted-foreground">
                              {shortAddr(query.trim(), 6, 4)}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={openAddForm}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-border/40 text-xs text-amber"
                        >
                          <UserPlus className="w-3 h-3" />
                          Add new athlete
                          {query.trim() && !queryIsAddress ? `: "${query.trim()}"` : ""}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {adding && (
                  <div className="bg-card/40 border border-border/60 p-4 rounded-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                        Add new athlete
                      </div>
                      <button
                        onClick={() => setAdding(false)}
                        className="text-muted-foreground hover:text-chalk"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Full name (e.g. Maya Chen)"
                      className="w-full bg-input border border-border focus:border-amber focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk text-sm"
                    />
                    <input
                      type="text"
                      value={newAddr}
                      onChange={(e) => setNewAddr(e.target.value)}
                      placeholder="0x…"
                      className="w-full bg-input border border-border focus:border-amber focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk font-mono text-xs"
                    />
                    <button
                      onClick={handleSaveNew}
                      className="bg-amber hover:bg-amber-soft text-ink px-4 py-2 text-sm font-bold tracking-wide rounded-sm transition-colors"
                    >
                      Save athlete
                    </button>
                  </div>
                )}

                {selected && !adding && (
                  <MiniProfileCard address={selected.address} variant="card" />
                )}

                {list.length === 0 && !adding && (
                  <p className="text-xs text-muted-foreground font-light">
                    No athletes yet — add your first one with the button above.
                  </p>
                )}

                <button
                  onClick={goStep2}
                  disabled={!selected}
                  className="bg-amber hover:bg-amber-soft text-ink px-6 py-2.5 font-bold tracking-wide rounded-sm transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ) : selected ? (
              <CompletedRow
                onEdit={goStep1}
                content={<MiniProfileCard address={selected.address} variant="row" />}
              />
            ) : null}

            <StepHeader step={2} active={step >= 2} title="Tape" onClick={goStep2} />
            {step === 2 ? (
              <div className="space-y-4">
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
                  <>
                    <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                      Athlete's library · {tapes.length}
                    </div>
                    <ul className="grid sm:grid-cols-2 gap-3">
                      {tapes.map((t) => {
                        const active = pickedCid === t.cid;
                        return (
                          <li key={t.id}>
                            <button
                              type="button"
                              onClick={() => handlePickTape(t)}
                              className={`w-full text-left p-3 rounded-sm border flex items-center gap-3 transition-colors ${
                                active
                                  ? "border-amber bg-amber/10"
                                  : "border-border/50 bg-card/40 hover:border-amber/40"
                              }`}
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
                              {active && (
                                <CheckCircle2 className="w-4 h-4 text-amber shrink-0" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground font-light">
                    No tapes in this athlete's library yet — upload one on their behalf below.
                  </p>
                )}

                <details
                  open={tapes.length === 0}
                  className="border border-border/50 rounded-sm overflow-hidden"
                >
                  <summary className="px-4 py-3 cursor-pointer text-xs uppercase tracking-widest font-bold text-muted-foreground hover:bg-card/40 transition-colors">
                    Upload a tape on this athlete's behalf
                  </summary>
                  <div className="p-4 border-t border-border/50">
                    <label
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!isUploading) setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      className={`block w-full border-2 border-dashed transition-all rounded-sm p-6 text-center cursor-pointer ${
                        isDragging
                          ? "border-amber bg-amber/10"
                          : "border-border/50 hover:border-amber/50 bg-card/30 hover:bg-card/60"
                      } ${isUploading ? "pointer-events-none opacity-50" : ""}`}
                    >
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void ingestUpload(f);
                        }}
                        disabled={isUploading}
                      />
                      <Upload
                        className={`w-7 h-7 mx-auto mb-2 transition-colors ${
                          isDragging ? "text-amber" : "text-muted-foreground"
                        }`}
                      />
                      <p className="text-chalk font-medium mb-1 text-sm">
                        {isDragging
                          ? "Drop to upload"
                          : "Drag a video here, or click to browse"}
                      </p>
                      <p className="text-muted-foreground text-xs">MP4, MOV up to 200&nbsp;MB</p>
                    </label>
                    {isUploading && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-muted-foreground font-mono mb-1">
                          <span>Uploading to IPFS…</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="h-1 bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber transition-all duration-200"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </details>

                {pickedCid && (
                  <button
                    onClick={goStep3}
                    className="bg-amber hover:bg-amber-soft text-ink px-6 py-2.5 font-bold tracking-wide rounded-sm transition-all flex items-center gap-2"
                  >
                    Continue <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            ) : (
              pickedCid && (
                <CompletedRow
                  onEdit={goStep2}
                  content={
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4 text-amber/80" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-chalk truncate">{pickedLabel}</div>
                        <div className="text-[10px] font-mono text-muted-foreground truncate">
                          {pickedSource === "upload" ? "Just uploaded" : "From library"} ·{" "}
                          {shortAddr(pickedCid, 6, 6)}
                        </div>
                      </div>
                    </div>
                  }
                />
              )
            )}

            <StepHeader
              step={3}
              active={step >= 3}
              title={mode === "bounty" ? "Budget, skills & deadline" : "Fee & deadline"}
              onClick={goStep3}
            />
            {step === 3 && mode === "direct" && (
              <div className="max-w-md space-y-6">
                <div className="bg-card/30 border border-border/50 p-6 rounded-sm space-y-5">
                  {visionModels.length > 1 && (
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                        Analysis model
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {visionModels.map((s) => {
                          const active =
                            selectedModel.toLowerCase() === s.toLowerCase();
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setSelectedModel(s)}
                              className={`text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-sm border transition-colors ${
                                active
                                  ? "bg-amber text-ink border-amber"
                                  : "text-muted-foreground border-border/60 hover:border-amber/40 hover:text-amber"
                              }`}
                            >
                              {skillLabel(s)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                      Analysis fee (STT) — min {minFee ? formatStt(minFee) : "—"}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={feeInput}
                        onChange={(e) => setFeeInput(e.target.value)}
                        className="flex-1 bg-input border border-border focus:border-amber focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk font-mono text-sm"
                      />
                      <span className="font-mono text-xs text-muted-foreground">STT</span>
                    </div>
                  </div>
                  <div className="border-t border-border/50 pt-4">
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                      Deadline (hours from now)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={directDeadlineHours}
                      onChange={(e) =>
                        setDirectDeadlineHours(
                          Math.floor(Number(e.target.value)) || 0,
                        )
                      }
                      className="w-full bg-input border border-border focus:border-amber focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk font-mono text-sm"
                    />
                    {directDeadlineHours > 0 && (
                      <p className="text-[11px] text-muted-foreground font-light mt-2">
                        Agent must submit before{" "}
                        <span className="text-chalk/80">
                          {new Date(
                            Date.now() + directDeadlineHours * 3600 * 1000,
                          ).toLocaleString()}
                        </span>
                        .
                      </p>
                    )}
                  </div>
                </div>

                <button
                  onClick={handlePay}
                  disabled={isSubmitting || !feeInput || directDeadlineHours <= 0}
                  className="w-full bg-amber hover:bg-amber-soft text-ink py-4 font-bold tracking-wide rounded-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Confirming on chain…" : "Sign & submit session"}
                </button>
              </div>
            )}
            {step === 3 && mode === "bounty" && (
              <div className="max-w-md space-y-6">
                <div className="bg-card/30 border border-border/50 p-6 rounded-sm space-y-5">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                      Budget (STT)
                      {minBountyFee ? ` — min ${formatStt(minBountyFee as bigint)}` : ""}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={bountyBudget}
                        onChange={(e) => setBountyBudget(e.target.value)}
                        className="flex-1 bg-input border border-border focus:border-amber focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk font-mono text-sm"
                        placeholder="0.0"
                      />
                      <span className="font-mono text-xs text-muted-foreground">STT</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                      Deadline (hours from now)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={bountyDeadlineHours}
                      onChange={(e) =>
                        setBountyDeadlineHours(Math.floor(Number(e.target.value)) || 0)
                      }
                      className="w-full bg-input border border-border focus:border-amber focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                      Required skills
                    </label>
                    {allBountySkills.length === 0 ? (
                      <p className="text-xs text-muted-foreground font-light">
                        No registered agents yet — leave skills empty to let
                        any agent bid.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {allBountySkills.map((s) => {
                          const active = bountySkills.has(s.toLowerCase());
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => toggleBountySkill(s)}
                              className={`text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-sm border transition-colors ${
                                active
                                  ? "bg-amber text-ink border-amber"
                                  : "text-muted-foreground border-border/60 hover:border-amber/40 hover:text-amber"
                              }`}
                            >
                              {skillLabel(s)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={handlePostBounty}
                  disabled={isSubmitting || postingBounty || !bountyBudget}
                  className="w-full bg-amber hover:bg-amber-soft text-ink py-4 font-bold tracking-wide rounded-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting || postingBounty ? "Posting bounty…" : "Sign & post bounty"}
                </button>
              </div>
            )}

            {step === 4 && success && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="border-l-2 border-amber pl-6 py-2"
              >
                <h2 className="text-xl font-serif-display text-chalk mb-4 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-amber" />
                  Session opened
                  {selected && (
                    <span className="text-muted-foreground font-light text-base">
                      for {selected.name}
                    </span>
                  )}
                </h2>
                <div className="max-w-xl space-y-3 bg-card/50 border border-amber/30 p-6 rounded-sm">
                  {success.jobId && (
                    <Row
                      label="Job ID"
                      value={success.jobId}
                      onCopy={() => copy(success.jobId!)}
                    />
                  )}
                  <Row
                    label="Tx hash"
                    value={success.txHash}
                    onCopy={() => copy(success.txHash)}
                    href={`${somniaTestnet.blockExplorers?.default.url}/tx/${success.txHash}`}
                  />
                  <Row
                    label="Video CID"
                    value={success.cid}
                    onCopy={() => copy(success.cid)}
                    href={
                      success.isDemoCid || success.cid.startsWith("local:")
                        ? undefined
                        : ipfsGatewayUrl(success.cid)
                    }
                  />
                  <div className="flex gap-3 pt-4">
                    {success.jobId && (
                      <button
                        onClick={() => setLocation(`/coach/jobs/${success.jobId}`)}
                        className="bg-amber hover:bg-amber-soft text-ink px-5 py-2.5 font-bold tracking-wide rounded-sm transition-colors flex items-center gap-2"
                      >
                        Open session <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setLocation("/coach")}
                      className="border border-border hover:border-amber/50 text-chalk px-5 py-2.5 font-bold tracking-wide rounded-sm transition-colors"
                    >
                      Back to sessions
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* RIGHT: live receipt preview */}
          <aside className="lg:sticky lg:top-24 self-start">
            <div className="bg-card/30 border border-amber/20 rounded-sm p-6 space-y-5 shadow-[0_0_30px_rgba(245,177,75,0.05)]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber" />
                <div className="text-[10px] uppercase tracking-widest font-bold text-amber">
                  {mode === "bounty" ? "Bounty preview" : "Live receipt preview"}
                </div>
              </div>
              <p className="text-xs text-muted-foreground font-light leading-relaxed">
                {mode === "bounty"
                  ? "This is the bounty record that escrows STT and opens bidding to registered agents."
                  : "This is the exact payload the contract will store once you sign. It updates as you fill the wizard."}
              </p>

              <div className="space-y-3 text-sm">
                <PreviewRow
                  label="Athlete"
                  value={
                    selected ? (
                      <span className="flex items-center gap-2 min-w-0">
                        <AthleteMonogram name={selected.name} size="sm" />
                        <span className="truncate">{selected.name}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">— pick an athlete —</span>
                    )
                  }
                />
                <PreviewRow
                  label="Athlete addr"
                  value={
                    selected ? (
                      <span className="font-mono text-xs text-chalk/80">
                        {shortAddr(selected.address, 6, 6)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">—</span>
                    )
                  }
                />
                <PreviewRow
                  label="Tape"
                  value={
                    pickedCid ? (
                      <span className="text-chalk truncate inline-block max-w-full">
                        {pickedLabel}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">— pick or upload —</span>
                    )
                  }
                />
                <PreviewRow
                  label="Video CID"
                  value={
                    pickedCid ? (
                      <span className="font-mono text-xs text-chalk/80 break-all">
                        {pickedCid}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">—</span>
                    )
                  }
                />
                <PreviewRow
                  label={mode === "bounty" ? "Budget (escrow)" : "Fee"}
                  value={
                    (mode === "bounty" ? bountyBudget : feeInput) ? (
                      <span className="font-mono text-amber">
                        {mode === "bounty" ? bountyBudget : feeInput} STT
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">—</span>
                    )
                  }
                />
                {mode === "bounty" && (
                  <PreviewRow
                    label="Required skills"
                    value={
                      bountySkills.size === 0 ? (
                        <span className="text-muted-foreground italic">
                          any (open bidding)
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {Array.from(bountySkills).map((s) => (
                            <span
                              key={s}
                              className="font-mono text-[10px] bg-amber/10 text-amber border border-amber/30 px-1.5 py-0.5 rounded-sm"
                            >
                              {skillLabel(s as Hex)}
                            </span>
                          ))}
                        </span>
                      )
                    }
                  />
                )}
                <PreviewRow
                  label="Deadline"
                  value={
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-chalk/80">
                      <Clock className="w-3 h-3 text-amber/70" />
                      {mode === "bounty" ? bountyDeadlineHours : DEADLINE_HOURS}h from signing
                    </span>
                  }
                />
              </div>

              <div className="pt-4 border-t border-border/50">
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                  What happens after you sign
                </div>
                <ol className="space-y-2 text-xs text-chalk/80">
                  <li className="flex items-start gap-2">
                    <span className="text-amber font-mono">01</span> Fee is escrowed in
                    VeloOrchestrator on Somnia.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber font-mono">02</span> Form agent returns an
                    EIP-712 signed stroke report.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber font-mono">03</span> Prescription agent
                    returns a signed corrective plan.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber font-mono">04</span> Both receipts are
                    appended to the athlete's SBT.
                  </li>
                </ol>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function StepHeader({
  step,
  active,
  title,
  onClick,
}: {
  step: number;
  active: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left border-l-2 pl-4 py-1 transition-colors ${
        active ? "border-amber" : "border-border/50 opacity-60 hover:opacity-90"
      }`}
    >
      <h2 className="text-xl font-serif-display text-chalk flex items-center gap-3">
        <span className="text-amber text-sm font-sans font-bold tabular-nums">
          {String(step).padStart(2, "0")}
        </span>
        {title}
      </h2>
    </button>
  );
}

function CompletedRow({
  content,
  onEdit,
}: {
  content: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 bg-card/40 border border-border/50 px-3 py-2 rounded-sm">
      <div className="min-w-0 flex-1">{content}</div>
      <button
        onClick={onEdit}
        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-muted-foreground hover:text-amber"
      >
        <ArrowLeft className="w-3 h-3" /> Edit
      </button>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
        {label}
      </span>
      <span className="text-chalk">{value}</span>
    </div>
  );
}

function Row({
  label,
  value,
  onCopy,
  href,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm border-b border-border/30 pb-2 last:border-b-0">
      <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
        {label}
      </span>
      <span className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-chalk/90 truncate text-xs">{value}</span>
        <button onClick={onCopy} className="text-muted-foreground hover:text-amber">
          <Copy className="w-3 h-3" />
        </button>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-amber"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </span>
    </div>
  );
}
