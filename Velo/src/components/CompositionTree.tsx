import { Link } from "wouter";
import type { Address } from "viem";
import { useAgent } from "@/lib/domain/agents";
import { ipfsGatewayUrl } from "@/lib/web3/uploader";
import { shortAddr } from "@/lib/format";
import { Bot, ExternalLink, GitBranch } from "lucide-react";

export type CompositionNode = {
  role: "lead" | "sub";
  agent: Address;
  label?: string;
  shareBps?: number;
  receiptCid?: string;
  receiptUrl?: string;
};

/**
 * Vertical tree showing lead agent + sub-agents. Each node looks up the
 * agent's display name from AgentRegistry, shows its payout share (if known)
 * and links to its receipt on IPFS.
 */
export function CompositionTree({
  nodes,
  emptyHint,
}: {
  nodes: CompositionNode[];
  emptyHint?: string;
}) {
  if (nodes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground font-light">
        {emptyHint ?? "No composition recorded yet."}
      </p>
    );
  }
  const lead = nodes.find((n) => n.role === "lead");
  const subs = nodes.filter((n) => n.role === "sub");
  return (
    <div className="border border-border/50 rounded-sm bg-card/40 p-4">
      <div className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        <GitBranch className="w-3.5 h-3.5 text-amber/70" /> Composition
      </div>
      <ol className="space-y-2">
        {lead && <Node node={lead} />}
        {subs.map((n, i) => (
          <li key={`${n.agent}-${i}`} className="flex items-stretch gap-3 pl-3">
            <span className="w-2 border-l border-b border-amber/40 -mt-1 mb-3 self-stretch shrink-0" />
            <div className="flex-1 min-w-0">
              <Node node={n} inline />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Node({ node, inline = false }: { node: CompositionNode; inline?: boolean }) {
  const { data: ag } = useAgent(node.agent);
  const primaryName = node.label || ag?.name || shortAddr(node.agent, 6, 4);
  const secondaryName =
    node.label && ag?.name && ag.name !== node.label ? ag.name : null;
  const inner = (
    <div className="flex items-center gap-3 px-3 py-2 bg-background/60 border border-border/40 rounded-sm">
      <div className="w-7 h-7 rounded-sm bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
        <Bot className="w-3.5 h-3.5 text-amber/90" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/a/${node.agent}`}
            className="text-sm text-chalk hover:text-amber transition-colors truncate font-medium"
          >
            {primaryName}
          </Link>
          <span
            className={`text-[10px] uppercase tracking-widest font-bold border px-1.5 py-0.5 rounded-sm ${
              node.role === "lead"
                ? "text-amber bg-amber/10 border-amber/30"
                : "text-chalk/70 bg-chalk/5 border-border/60"
            }`}
          >
            {node.role}
          </span>
          {node.shareBps !== undefined && (
            <span className="text-[10px] uppercase tracking-widest font-bold text-chalk/70 bg-chalk/5 border border-border/60 px-1.5 py-0.5 rounded-sm font-mono">
              {(node.shareBps / 100).toFixed(node.shareBps % 100 === 0 ? 0 : 1)}%
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground truncate">
          {shortAddr(node.agent, 6, 4)}
        </div>
        {secondaryName && (
          <div className="text-[10px] text-muted-foreground/80 truncate">
            Registry: {secondaryName}
          </div>
        )}
      </div>
      {(node.receiptUrl || (node.receiptCid && !node.receiptCid.startsWith("local:"))) && (
        <a
          href={node.receiptUrl ?? ipfsGatewayUrl(node.receiptCid!)}
          target="_blank"
          rel="noreferrer"
          title={node.receiptUrl ? "Consensus receipt on Somnia Agents" : "Receipt on IPFS"}
          className="text-muted-foreground hover:text-amber shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
  return inline ? inner : <li>{inner}</li>;
}
