import type { ComponentType, ReactNode } from "react";
import { RefreshCw, AlertTriangle, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The canonical card-shaped loading placeholder. Replaces the
 * `bg-card/50 border border-border/50 rounded-sm animate-pulse` string that was
 * copy-pasted across pages, so the pulse treatment stays identical everywhere.
 */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-card/50 border border-border/50 rounded-sm animate-pulse",
        className,
      )}
    />
  );
}

/** Renders `count` evenly-stacked card skeletons. */
export function CardSkeletonList({
  count = 3,
  itemClassName = "h-20",
  className,
}: {
  count?: number;
  itemClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} className={itemClassName} />
      ))}
    </div>
  );
}

/**
 * Shared empty-state block: a circular icon badge over a dashed card. Use for
 * "nothing here yet" / "no matches" across every page.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center py-16 px-6 border border-dashed border-border/50 rounded-sm bg-card/20",
        className,
      )}
    >
      <div className="w-14 h-14 bg-card border border-border/50 rounded-full flex items-center justify-center mb-5">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      {description && (
        <p className="text-xs text-muted-foreground font-light mt-2 max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Shared error-state block with an optional retry. Use for data-fetch failures
 * so a chain/RPC hiccup never leaves a page looking empty or broken. `icon`
 * defaults to a warning triangle but can be overridden per surface.
 */
export function ErrorState({
  icon: Icon = AlertTriangle,
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Retry",
  className,
}: {
  icon?: ComponentType<LucideProps>;
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center py-16 px-6 border border-dashed border-destructive/30 rounded-sm bg-destructive/5",
        className,
      )}
    >
      <div className="w-14 h-14 bg-card border border-destructive/30 rounded-full flex items-center justify-center mb-5">
        <Icon className="w-5 h-5 text-destructive/70" />
      </div>
      <p className="text-sm text-chalk font-medium">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground font-mono mt-1 max-w-sm">
          {description}
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-amber/40 text-amber hover:bg-amber/10 rounded-sm transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> {retryLabel}
        </button>
      )}
    </div>
  );
}
