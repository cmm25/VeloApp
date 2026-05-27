import { BadgeCheck, CircleDashed } from "lucide-react";

type Size = "sm" | "md";

/**
 * Tiny indicator next to an athlete name showing whether the address has
 * confirmed ownership with a wallet signature. Coach-set names render as
 * "Pending" until the athlete claims them on their own device.
 */
export function VerifiedBadge({
  verified,
  size = "sm",
  className = "",
}: {
  verified: boolean;
  size?: Size;
  className?: string;
}) {
  const iconCls = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  const textCls = size === "sm" ? "text-[9px]" : "text-[10px]";
  if (verified) {
    return (
      <span
        title="Name confirmed by the athlete's wallet signature"
        className={`inline-flex items-center gap-1 ${textCls} uppercase tracking-widest font-bold text-amber bg-amber/10 border border-amber/30 px-1.5 py-0.5 rounded-sm ${className}`}
      >
        <BadgeCheck className={iconCls} />
        Verified
      </span>
    );
  }
  return (
    <span
      title="Coach-set name — not yet confirmed by the athlete"
      className={`inline-flex items-center gap-1 ${textCls} uppercase tracking-widest font-bold text-muted-foreground bg-card border border-border/60 px-1.5 py-0.5 rounded-sm ${className}`}
    >
      <CircleDashed className={iconCls} />
      Pending
    </span>
  );
}
