import type { Address } from "viem";
import { useAthleteReceipts } from "@/hooks/useVeloContracts";
import { useIpfsJson, summaryFromReport } from "@/lib/web3/ipfs";
import { ipfsGatewayUrl } from "@/lib/web3/uploader";
import { Sparkles, ExternalLink } from "lucide-react";

/**
 * Compact card surfacing the most recent prescription receipt for an athlete,
 * powered by the Progress Analyst's IPFS summary. Renders nothing while no
 * receipts are available so it can sit safely at the top of any dashboard.
 */
export function InsightBar({ address }: { address?: Address }) {
  const { receipts } = useAthleteReceipts(address);
  const latest = receipts[receipts.length - 1];
  const ipfsQ = useIpfsJson(latest?.ipfsCid);

  if (!latest) return null;

  const summary = summaryFromReport(ipfsQ.data) ?? "Latest receipt is on-chain.";
  const ts = Number(latest.timestamp) * 1000;
  const when = ts > 0 ? new Date(ts).toLocaleDateString() : "—";

  return (
    <div className="mb-10 border border-amber/30 bg-amber/[0.04] rounded-sm px-5 py-4 flex items-start gap-4">
      <div className="w-9 h-9 rounded-sm bg-amber/15 border border-amber/40 flex items-center justify-center shrink-0">
        <Sparkles className="w-4 h-4 text-amber" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-widest font-bold text-amber mb-1">
          Latest insight · {when}
        </div>
        <p className="text-sm text-chalk leading-snug line-clamp-2">{summary}</p>
      </div>
      {!latest.ipfsCid.startsWith("local:") && (
        <a
          href={ipfsGatewayUrl(latest.ipfsCid)}
          target="_blank"
          rel="noreferrer"
          className="text-amber hover:text-amber-soft shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold"
        >
          Open <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}
