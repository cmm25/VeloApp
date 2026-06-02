import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { FullPageLoader } from "@/components/ui/spinner";
import { shortAddr } from "@/lib/format";
import { useMyOnChainRole } from "@/lib/domain/onchainRole";
import {
  athleteSbtRoleAbi,
  coachRegistryAbi,
} from "@/lib/web3/coachRegistryAbi";
import { deployment } from "@/lib/web3/deployment";
import type { Role } from "@/lib/domain/roles";

type RoleOption = {
  id: Role;
  title: string;
  cost: string;
  tagline: string;
};

const ROLES: RoleOption[] = [
  {
    id: "athlete",
    title: "Athlete",
    cost: "One on-chain tx · gas only",
    tagline:
      "Mint a soulbound athlete token. Your training receipts attach to it across every coach.",
  },
  {
    id: "coach",
    title: "Coach",
    cost: "One on-chain tx · gas only",
    tagline:
      "Register on the public Coach roster. Then pay per session in STT to run verifiable jobs.",
  },
];

export default function ChooseRole() {
  const { address } = useAccount();
  const [, setLocation] = useLocation();
  const { role: currentRole, isLoading: roleLoading, refetch } = useMyOnChainRole();
  const pub = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState<Role | null>(null);
  const [coachName, setCoachName] = useState<string>("");

  // Hold the screen while the chain query is in-flight — prevents the "Choose
  // a role" UI flashing for accounts that already have an established role.
  if (roleLoading) {
    return <FullPageLoader label="Reading on-chain role…" />;
  }

  // If they already have a role, send them to their home.
  if (currentRole) {
    setLocation(`/${currentRole}`);
    return null;
  }

  const sbt = deployment?.contracts.athleteSBT;
  const coachReg = deployment?.contracts.coachRegistry;

  const handleSelect = async (role: Role) => {
    if (!address || !sbt) {
      toast.error("Deployment not loaded");
      return;
    }
    if (role === "coach" && !coachReg) {
      toast.error("Coach registry not deployed");
      return;
    }
    if (role === "coach" && coachName.trim().length === 0) {
      toast.error("Enter a display name for your coach profile");
      return;
    }
    setPending(role);
    try {
      const hash =
        role === "athlete"
          ? await writeContractAsync({
              address: sbt,
              abi: athleteSbtRoleAbi,
              functionName: "register",
              args: [],
            })
          : await writeContractAsync({
              address: coachReg!,
              abi: coachRegistryAbi,
              functionName: "register",
              args: [coachName.trim()],
            });
      toast.loading("Confirming on Somnia…", { id: "role-tx" });
      await pub?.waitForTransactionReceipt({ hash });
      toast.success("Role secured on-chain", { id: "role-tx" });
      refetch();
      setLocation(`/${role}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Registration failed", { description: msg, id: "role-tx" });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-amber/30 selection:text-amber">
      <TopBar />

      <main className="flex-1 flex flex-col items-center justify-center p-6 pb-24">
        <motion.div
          className="w-full max-w-5xl space-y-12"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
          }}
        >
          <div className="text-center space-y-4">
            <motion.h1
              variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
              className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight"
            >
              Choose a role
            </motion.h1>
            <motion.p
              variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
              className="text-muted-foreground font-mono text-[11px] uppercase tracking-widest"
            >
              {shortAddr(address)} · roles are on-chain & sticky
            </motion.p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto w-full">
            {ROLES.map((r) => {
              const isPending = pending === r.id;
              const disabled = pending !== null;
              return (
                <motion.div
                  key={r.id}
                  variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                  className="group text-left p-8 border border-border/50 bg-card/50 hover:bg-border/30 hover:border-amber/50 transition-all rounded-sm flex flex-col h-full relative overflow-hidden min-h-[260px]"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-amber/5 blur-3xl rounded-full group-hover:bg-amber/10 transition-colors -mr-16 -mt-16 pointer-events-none" />

                  <h2 className="font-serif-display text-3xl mb-3 text-chalk group-hover:text-amber transition-colors">
                    {r.title}
                  </h2>
                  <p className="text-sm text-chalk/70 font-light leading-relaxed mb-4">
                    {r.tagline}
                  </p>
                  {r.id === "coach" && (
                    <input
                      value={coachName}
                      onChange={(e) => setCoachName(e.target.value)}
                      maxLength={48}
                      disabled={disabled}
                      placeholder="Display name (visible on-chain)"
                      className="mb-3 px-3 py-2 bg-background/80 border border-border/60 rounded-sm text-sm font-mono text-chalk placeholder:text-muted-foreground focus:outline-none focus:border-amber/50"
                    />
                  )}
                  <div className="flex-1" />
                  <div className="text-[10px] uppercase tracking-widest font-bold text-amber/80 mb-4">
                    {r.cost}
                  </div>
                  <button
                    onClick={() => handleSelect(r.id)}
                    disabled={disabled}
                    className="text-xs font-bold uppercase tracking-widest text-chalk/80 hover:text-amber disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 self-start"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Confirm in wallet…
                      </>
                    ) : (
                      <>
                        Register as {r.title.toLowerCase()}{" "}
                        <span className="opacity-60">→</span>
                      </>
                    )}
                  </button>
                </motion.div>
              );
            })}
          </div>

          <motion.p
            variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
            className="text-center text-[10px] uppercase tracking-widest text-muted-foreground"
          >
            Switching role later requires deleting the account and re-registering.
          </motion.p>
        </motion.div>
      </main>
    </div>
  );
}
