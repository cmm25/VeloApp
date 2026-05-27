import { useState } from "react";
import { useCreateInvite } from "@/lib/domain/roster";
import { Loader2, Mail, Copy, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Modal for emailing an athlete a magic-link invite. In demo mode the
 * server returns the plaintext claim URL so the coach can copy/paste it.
 */
export function InviteAthleteModal({ onClose }: { onClose: () => void }) {
  const create = useCreateInvite();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [result, setResult] = useState<{ claimUrl: string; mode: "sent" | "demo"; email: string } | null>(
    null,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const out = await create.mutateAsync({ email: email.trim(), displayName: displayName.trim() });
      setResult({ claimUrl: out.claimUrl, mode: out.email.mode, email: out.invite.email });
      if (out.email.mode === "sent") {
        toast.success(`Invite emailed to ${out.invite.email}`);
      } else {
        toast.info("Demo mode — copy the link below");
      }
    } catch (err) {
      toast.error("Invite failed", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.claimUrl).then(() => toast.success("Claim link copied"));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/60 rounded-sm w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
          <div className="font-serif-display text-xl text-chalk">Invite an athlete</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-chalk">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!result ? (
          <form onSubmit={submit} className="p-5 space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground block mb-1.5">
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Maya Chen"
                required
                maxLength={80}
                className="w-full bg-input border border-border focus:border-amber focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground block mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="maya@example.com"
                required
                maxLength={200}
                className="w-full bg-input border border-border focus:border-amber focus:ring-1 focus:ring-amber rounded-sm px-3 py-2 text-chalk text-sm"
              />
              <p className="text-[10px] text-muted-foreground font-light mt-2 leading-relaxed">
                We'll email a one-time claim link. The athlete connects (or creates) a wallet to
                accept and starts owning their training record.
              </p>
            </div>
            <button
              type="submit"
              disabled={create.isPending}
              className="w-full inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-soft disabled:opacity-50 text-ink px-4 py-2.5 rounded-sm font-bold tracking-wide"
            >
              {create.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4" /> Send invite
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-amber">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-[10px] uppercase tracking-widest font-bold">
                {result.mode === "sent" ? "Invite sent" : "Demo invite ready"}
              </span>
            </div>
            <p className="text-sm text-chalk/80 leading-relaxed">
              {result.mode === "sent"
                ? `Emailed to ${result.email}. They'll claim within 14 days.`
                : "Email isn't configured — copy this one-time link and send it manually."}
            </p>
            <div className="bg-background border border-border/60 rounded-sm p-3 font-mono text-[11px] text-chalk/80 break-all">
              {result.claimUrl}
            </div>
            <div className="flex gap-2">
              <button
                onClick={copy}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-card hover:bg-border/40 border border-border/60 text-chalk px-3 py-2 rounded-sm text-sm"
              >
                <Copy className="w-3.5 h-3.5" /> Copy link
              </button>
              <button
                onClick={onClose}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-soft text-ink px-3 py-2 rounded-sm text-sm font-bold tracking-wide"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
