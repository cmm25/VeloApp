import { Link } from "wouter";
import { type Address } from "viem";
import { AthleteMonogram } from "./AthleteMonogram";
import { VerifiedBadge } from "./VerifiedBadge";
import { useAthleteDirectory } from "@/lib/domain/athletes";
import { useAthleteReceipts } from "@/hooks/useVeloContracts";
import { shortAddr } from "@/lib/format";
import { ExternalLink, Activity } from "lucide-react";

type Variant = "row" | "card";

/**
 * Reusable athlete mini-profile. Renders a monogram, claimed name with
 * verification status, address, on-chain receipt count, and a deep link to
 * the public profile. Used in the coach picker, roster lists, and
 * any header that talks about a specific athlete.
 */
export function MiniProfileCard({
  address,
  variant = "card",
  showProfileLink = true,
  className = "",
}: {
  address: Address;
  variant?: Variant;
  showProfileLink?: boolean;
  className?: string;
}) {
  const { resolve } = useAthleteDirectory();
  const athlete = resolve(address);
  const name = athlete?.name ?? "Athlete";
  const { count, receipts } = useAthleteReceipts(address);
  const lastReceipt = receipts[receipts.length - 1];
  const lastTs = lastReceipt ? Number(lastReceipt.timestamp) * 1000 : null;

  if (variant === "row") {
    return (
      <div
        className={`flex items-center gap-3 min-w-0 ${className}`}
        data-testid="mini-profile-row"
      >
        <AthleteMonogram name={name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="font-serif-display text-base text-chalk truncate leading-tight">
              {name}
            </span>
            {athlete && <VerifiedBadge verified={athlete.verified} />}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground truncate flex items-center gap-2">
            <span>{shortAddr(address, 6, 4)}</span>
            <span className="text-border">·</span>
            <span>
              {count} receipt{count === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {showProfileLink && (
          <Link
            href={`/p/${address}`}
            className="text-muted-foreground hover:text-amber transition-colors"
            title="Open public profile"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    );
  }

  return (
    <div
      className={`p-4 bg-card/40 border border-border/50 rounded-sm hover:border-amber/40 transition-colors ${className}`}
      data-testid="mini-profile-card"
    >
      <div className="flex items-center gap-3 mb-3">
        <AthleteMonogram name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-serif-display text-xl text-chalk truncate leading-tight">
              {name}
            </div>
            {athlete && <VerifiedBadge verified={athlete.verified} />}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground truncate">
            {shortAddr(address, 6, 4)}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] font-mono">
        <div className="flex items-center gap-1.5 text-chalk/80">
          <Activity className="w-3 h-3 text-amber/80" />
          <span>
            {count} receipt{count === 1 ? "" : "s"}
          </span>
        </div>
        <div className="text-muted-foreground">
          {lastTs
            ? `last ${new Date(lastTs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
            : "no activity yet"}
        </div>
      </div>
      {showProfileLink && (
        <Link
          href={`/p/${address}`}
          className="mt-3 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-amber hover:text-amber-soft transition-colors"
        >
          Open public profile <ExternalLink className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}
