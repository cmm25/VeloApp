import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { useMyOnChainRole } from "@/lib/domain/onchainRole";
import {
  athleteSbtRoleAbi,
  coachRegistryAbi,
} from "@/lib/web3/coachRegistryAbi";
import { deployment } from "@/lib/web3/deployment";
import { apiAuthFetch } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/domain/roles";

/**
 * Account deletion flow.
 *
 *   1. Wipe server-side DB rows for this address via DELETE /api/account.
 *   2. Submit the on-chain "leave role" tx:
 *      - athlete  → AthleteSBT.burn()
 *      - coach    → CoachRegistry.deregister()
 *   3. Route back to /choose-role so they can register as the other side.
 */
export default function DeleteAccount() {
  const { address } = useAccount();
  const [, setLocation] = useLocation();
  const { role, isLoading, refetch } = useMyOnChainRole();
  const pub = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<"idle" | "server" | "chain">("idle");
  const [confirm, setConfirm] = useState("");

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-amber" />
      </div>
    );
  }

  const sbt = deployment?.contracts.athleteSBT;
  const coachReg = deployment?.contracts.coachRegistry;

  const onConfirm = async () => {
    if (!address || !role) return;
    if (confirm.trim().toUpperCase() !== "DELETE") {
      toast.error('Type "DELETE" to confirm');
      return;
    }

    // The on-chain tx is the source of truth, so resolve the target contract
    // up front and fail clearly if the deployment is missing it.
    const target = role === "athlete" ? sbt : coachReg;
    if (!target) {
      toast.error("Deletion unavailable", {
        description:
          role === "athlete"
            ? "AthleteSBT address is missing from the deployment."
            : "CoachRegistry address is missing from the deployment.",
      });
      return;
    }

    try {
      // Best-effort server-side wipe. This requires a SIWE session against the
      // agent runner API; if that API is down or the route is absent, we must
      // NOT block the on-chain deletion (the part that actually releases the
      // role). Swallow any failure here and continue to the chain tx.
      setBusy("server");
      try {
        const res = await apiAuthFetch("/api/account", { method: "DELETE" });
        if (!res.ok && res.status !== 404) {
          const body = await res.text().catch(() => "");
          console.warn(`Server-side account wipe failed: ${res.status} ${body}`);
        }
      } catch (serverErr) {
        console.warn(
          "Server-side account wipe skipped (API unreachable):",
          serverErr,
        );
      }

      setBusy("chain");
      const hash =
        role === "athlete"
          ? await writeContractAsync({
              address: target,
              abi: athleteSbtRoleAbi,
              functionName: "burn",
              args: [],
            })
          : await writeContractAsync({
              address: target,
              abi: coachRegistryAbi,
              functionName: "deregister",
              args: [],
            });
      toast.loading("Confirming on Somnia…", { id: "del-tx" });
      await pub?.waitForTransactionReceipt({ hash });
      toast.success("Account deleted. Choose your new role.", { id: "del-tx" });
      refetch();
      setLocation("/choose-role");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Deletion failed", { description: msg, id: "del-tx" });
    } finally {
      setBusy("idle");
    }
  };

  if (!role) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <TopBar />
        <main className="max-w-xl mx-auto p-12 text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            No on-chain role to delete.
          </p>
          <button
            onClick={() => setLocation("/choose-role")}
            className="text-xs uppercase tracking-widest font-bold text-amber"
          >
            Choose a role →
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <TopBar />
      <main className="flex-1 max-w-xl w-full mx-auto p-6 md:p-12 space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-widest font-bold">
              Irreversible
            </span>
          </div>
          <h1 className="font-serif-display text-3xl md:text-4xl text-chalk tracking-tight">
            Delete your {ROLE_LABELS[role]} account
          </h1>
          <p className="text-sm text-chalk/70 font-light leading-relaxed">
            This wipes your server-side rows and submits an on-chain tx to
            release this address. After it confirms, this wallet can register
            on either side again.
          </p>
        </motion.div>

        <div className="border border-border/60 bg-card/40 p-5 rounded-sm space-y-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            What will happen
          </p>
          <ul className="text-sm text-chalk/80 space-y-1.5 list-disc list-inside">
            <li>Server: rows for this address are removed from the Velo DB.</li>
            {role === "athlete" ? (
              <li>
                Chain: <code className="font-mono text-amber">AthleteSBT.burn()</code> —
                your SBT token and receipt log are deleted.
              </li>
            ) : (
              <li>
                Chain:{" "}
                <code className="font-mono text-amber">
                  CoachRegistry.deregister()
                </code>{" "}
                — your coach record is removed from the public roster.
              </li>
            )}
            <li>You will be sent to <span className="text-chalk">/choose-role</span>.</li>
          </ul>
          <p className="text-[10px] text-muted-foreground leading-snug pt-1">
            Past receipts already anchored on the SBT are part of immutable
            chain history; this tx removes them from your token but they
            remain visible in the transaction log of the block they were
            written in.
          </p>
        </div>

        <div className="space-y-3">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            Type DELETE to confirm
          </label>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy !== "idle"}
            className="w-full px-3 py-2 bg-background/80 border border-border/60 rounded-sm text-sm font-mono text-chalk placeholder:text-muted-foreground focus:outline-none focus:border-destructive/60"
            placeholder="DELETE"
          />
          <div className="flex gap-2">
            <button
              onClick={() => window.history.back()}
              disabled={busy !== "idle"}
              className="px-4 py-2 text-xs uppercase tracking-widest font-bold border border-border/60 text-chalk/80 hover:bg-border/30 rounded-sm"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy !== "idle" || confirm.trim().toUpperCase() !== "DELETE"}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-widest font-bold bg-destructive hover:bg-destructive/80 disabled:opacity-50 text-white rounded-sm"
            >
              {busy === "server" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Wiping server…
                </>
              ) : busy === "chain" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending tx…
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" /> Delete account
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
