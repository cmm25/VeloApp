import type { LucideIcon } from "lucide-react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared loading / empty / error state primitives.
 *
 * Several pages had hand-rolled copies of the same "dashed box with a centered
 * icon and mono caption" pattern; these consolidate that vocabulary so every
 * surface renders the three async states identically.
 */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 py-16 border border-dashed border-border/50 rounded-sm bg-card/20 text-center",
        className,
      )}
    >
      <Icon className="w-8 h-8 text-muted-foreground/50" />
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
          {title}
        </p>
        {description && (
          <p className="text-[10px] font-mono text-muted-foreground/60 max-w-xs mx-auto">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  icon: Icon,
  title,
  description,
  onRetry,
  retryLabel = "Retry",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 py-16 border border-dashed border-destructive/30 rounded-sm bg-destructive/5 text-center",
        className,
      )}
    >
      <Icon className="w-8 h-8 text-destructive/60" />
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-destructive/80 mb-2">
          {title}
        </p>
        {description && (
          <p className="text-[10px] font-mono text-muted-foreground/70 max-w-xs mx-auto">
            {description}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-amber/40 text-amber hover:bg-amber/10 rounded-sm transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> {retryLabel}
        </button>
      )}
    </div>
  );
}
