import { cn } from "@/lib/utils";

/**
 * The single source of truth for the app's loading spinner — an amber ring on a
 * faint track. Every page should use this rather than re-deriving the markup.
 */
export function Spinner({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "border-amber/30 border-t-amber rounded-full animate-spin",
        size === "sm" ? "w-4 h-4 border-2" : "w-8 h-8 border-2",
        className,
      )}
    />
  );
}

/**
 * Full-viewport loader used for route-level / role-gate waits. Keeps the
 * spinner + caption treatment identical everywhere.
 */
export function FullPageLoader({ label }: { label?: string }) {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <Spinner className="mx-auto" />
        {label && (
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
        )}
      </div>
    </div>
  );
}
