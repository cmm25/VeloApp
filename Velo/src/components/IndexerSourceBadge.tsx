import { useEffect, useState } from "react";
import { pingIndexer, type IndexerHealth } from "@/lib/web3/indexer";
import { Database, AlertTriangle } from "lucide-react";

/**
 * Tiny pill reporting where this page's data came from and how fresh it is.
 * Pings the api-server /healthz endpoint every 15s and shows the round-trip
 * latency next to a fixed source label so the user can see indexer vs. on-chain
 * RPC at a glance on every page that loads receipt history.
 */
export function IndexerSourceBadge({
  source,
  className,
}: {
  source: "indexer" | "rpc";
  className?: string;
}) {
  const [health, setHealth] = useState<IndexerHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const h = await pingIndexer();
      if (!cancelled) setHealth(h);
    };
    run();
    const id = setInterval(run, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
