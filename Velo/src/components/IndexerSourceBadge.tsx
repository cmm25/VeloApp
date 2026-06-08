import { useEffect, useRef, useState } from "react";
import { pingIndexerWithRetry, type IndexerHealth } from "@/lib/web3/indexer";
import { Database, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Tiny pill reporting where this page's data came from and how fresh it is.
 * Pings the api-server /healthz endpoint and shows the round-trip latency next
 * to a fixed source label so the user can see indexer vs. on-chain RPC at a
 * glance on every page that loads receipt history.
 *
 * The first ping uses bounded backoff: a free-tier backend cold start surfaces
 * as a transient failure for a few seconds, so the pill shows a friendly
 * "waking up…" state (with the live attempt count) instead of flipping to a
 * scary "down" during the first interaction of a demo. After it lands it
 * re-polls every 15s.
 */
export function IndexerSourceBadge({
  source,
  className,
}: {
  source: "indexer" | "rpc";
  className?: string;
}) {
  const [health, setHealth] = useState<IndexerHealth | null>(null);
  const [attempt, setAttempt] = useState(0);
  const runningRef = useRef(false);

  useEffect(() => {
    if (source !== "indexer") return;
    const controller = new AbortController();
    let cancelled = false;

    // Single-flight: a poll tick is skipped while a run is in progress, so an
    // older in-flight run can never overwrite a newer result (no stale race).
    const run = async (withRetry: boolean) => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const h = await pingIndexerWithRetry({
          // First load gets the full wake budget; periodic polls keep a small
          // budget so a later cold start still shows the waking state briefly.
          maxAttempts: withRetry ? 6 : 3,
          signal: controller.signal,
          onAttempt: (partial, n) => {
            if (cancelled) return;
            setHealth(partial);
            setAttempt(n);
          },
        });
        if (!cancelled) setHealth(h);
      } finally {
        runningRef.current = false;
      }
    };

    run(true);
    const id = setInterval(() => run(false), 15_000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
      runningRef.current = false;
    };
  }, [source]);

  const base =
    "inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-sm border";

  if (source === "rpc") {
    return (
      <span
        className={`${base} border-border/50 bg-card text-muted-foreground ${className ?? ""}`}
        title="Data loaded via on-chain RPC (no indexer in the path)"
      >
        <Database className="w-3 h-3" /> Source · RPC
      </span>
    );
  }

  if (!health) {
    return (
      <span className={`${base} border-border/50 bg-card text-muted-foreground ${className ?? ""}`}>
        <Database className="w-3 h-3" /> Source · indexer
      </span>
    );
  }
  if (health.status === "waking") {
    return (
      <span
        className={`${base} border-amber/50 bg-amber/10 text-amber ${className ?? ""}`}
        title="The analysis backend is on a free tier and is waking up — retrying automatically."
      >
        <Loader2 className="w-3 h-3 animate-spin" /> Waking up backend
        {attempt > 1 ? ` · try ${attempt}` : ""}
      </span>
    );
  }
  if (health.status === "down") {
    return (
      <span
        className={`${base} border-destructive/50 bg-destructive/10 text-destructive ${className ?? ""}`}
        title={`Indexer ping failed: ${health.reason}`}
      >
        <AlertTriangle className="w-3 h-3" /> Indexer down · {health.latencyMs} ms
      </span>
    );
  }
  return (
    <span
      className={`${base} border-amber/50 bg-amber/10 text-amber ${className ?? ""}`}
      title={`/api/healthz round-trip ${health.latencyMs} ms`}
    >
      <Database className="w-3 h-3" /> Indexer · {health.latencyMs} ms
    </span>
  );
}
