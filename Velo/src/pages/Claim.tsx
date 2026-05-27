import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { TopBar } from "@/components/TopBar";
import { useInviteByToken, useClaimInvite } from "@/lib/domain/roster";
import { shortAddr } from "@/lib/format";
import { CheckCircle2, Loader2, ShieldCheck, Wallet, XCircle } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

/**
 * Public claim page at /claim/:token. No wallet required to view; once the
 * athlete connects + signs a SIWE-style session, the server links them onto
 * the inviting coach's roster.
 */
export default function Claim({ token }: { token: string }) {
  const inviteQ = useInviteByToken(token);
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const claim = useClaimInvite();
  const [, setLocation] = useLocation();
  const [done, setDone] = useState(false);

  const invite = inviteQ.data;

  // Once invite is loaded AND wallet connects AND we haven't claimed yet,
  // require an explicit button press (so we never auto-sign without intent).

  const handleClaim = async () => {
    try {
      await claim.mutateAsync(token);
      // Role is resolved on-chain — once the orchestrator appends the first
      // receipt the SBT is auto-minted. Claim links can also be paired with
      // a one-time `register()` tx on /choose-role if the athlete arrives
      // before any session has been run.
      setDone(true);
      toast.success("Welcome to Velo");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Couldn't accept invite", { description: msg });
    }
  };

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setLocation("/athlete"), 1500);
    return () => clearTimeout(t);
  }, [done, setLocation]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-amber/30 selection:text-amber">
      <TopBar />
      <main className="flex-1 max-w-2xl w-full mx-auto p-6 md:p-12">
        {inviteQ.isLoading && (
          <div className="flex items-center gap-3 text-muted-foreground py-12">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading invite…
          </div>
        )}
        {inviteQ.isError && (
          <ErrorCard
            title="Invite link not found"
            body="This claim link is invalid or has already been used. Ask your coach for a fresh invite."
          />
        )}
        {invite && <InviteBody invite={invite} />}
        {invite && !invite.revokedAt && !invite.claimedAt && !invite.expired && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 p-6 bg-card/40 border border-border/60 rounded-sm"
          >
            {!isConnected ? (
              <>
                <p className="text-sm text-chalk/80 mb-4 leading-relaxed">
                  Connect a wallet to claim your training record. We recommend creating a fresh
                  embedded wallet — Velo never asks for your seed phrase.
                </p>
                <button
                  onClick={() => open()}
                  className="inline-flex items-center gap-2 bg-amber hover:bg-amber-soft text-ink px-5 py-2.5 rounded-sm font-bold tracking-wide"
                >
                  <Wallet className="w-4 h-4" /> Connect wallet
                </button>
              </>
            ) : done ? (
              <div className="flex items-center gap-2 text-amber font-medium">
                <CheckCircle2 className="w-4 h-4" /> Linked! Taking you to your dashboard…
              </div>
            ) : (
              <>
                <p className="text-sm text-chalk/80 mb-2">
                  Signing as <span className="font-mono text-chalk">{shortAddr(address!, 8, 6)}</span>
                </p>
                <p className="text-xs text-muted-foreground font-light mb-4">
                  We'll ask your wallet to sign one off-chain message to prove this address is yours.
                  No transaction will be sent.
                </p>
                <button
                  onClick={handleClaim}
                  disabled={claim.isPending}
                  className="inline-flex items-center gap-2 bg-amber hover:bg-amber-soft disabled:opacity-60 text-ink px-5 py-2.5 rounded-sm font-bold tracking-wide"
                >
                  {claim.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Signing…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" /> Accept invite
                    </>
                  )}
                </button>
              </>
            )}
          </motion.div>
        )}
        {invite?.revokedAt && (
          <ErrorCard title="Invite revoked" body="Your coach revoked this invitation. Ask them to send a new one." />
        )}
        {invite?.expired && !invite?.claimedAt && (
          <ErrorCard title="Invite expired" body="This invitation expired. Ask your coach to send a fresh one." />
        )}
        {invite?.claimedAt && (
          <ErrorCard
            title="Already claimed"
            body={
              invite.claimedAddress?.toLowerCase() === address?.toLowerCase()
                ? "You've already claimed this invite. Open your dashboard."
                : "This invite was already accepted by another wallet."
            }
            cta={
              invite.claimedAddress?.toLowerCase() === address?.toLowerCase() ? (
                <Link
                  href="/athlete"
                  className="inline-block text-amber hover:text-amber-soft text-sm font-bold tracking-wider uppercase"
                >
                  Open dashboard →
                </Link>
              ) : null
            }
          />
        )}
      </main>
    </div>
  );
}

function InviteBody({ invite }: { invite: { coachLabel: string | null; coachAddress: string; displayName: string; expiresAt: string } }) {
  const coach = invite.coachLabel ?? `Coach ${shortAddr(invite.coachAddress, 6, 4)}`;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-amber">You're invited</div>
      <h1 className="font-serif-display text-4xl md:text-5xl text-chalk tracking-tight leading-tight">
        {coach} invited you<br />
        to Velo as <span className="text-amber">{invite.displayName}</span>.
      </h1>
      <p className="text-sm text-chalk/70 font-light leading-relaxed max-w-lg">
        Velo is a verifiable training record you own. Accept this invite to start collecting
        on-chain receipts whenever {coach.split(" ")[0]} runs a session for you. You can carry your
        record to any future coach.
      </p>
      <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
        Expires {new Date(invite.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
      </p>
    </motion.div>
  );
}

function ErrorCard({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="border-l-2 border-destructive/50 pl-6 py-6 space-y-3">
      <div className="flex items-center gap-2 text-destructive">
        <XCircle className="w-4 h-4" />
        <span className="text-[10px] uppercase tracking-widest font-bold">{title}</span>
      </div>
      <p className="text-chalk/80 font-light">{body}</p>
      {cta}
    </div>
  );
}
