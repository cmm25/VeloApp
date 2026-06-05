import { useQuery } from "@tanstack/react-query";
import { ipfsGatewayUrl } from "@/lib/web3/uploader";

export function useIpfsJson(cid: string | undefined) {
  return useQuery({
    queryKey: ["velo:ipfs-json", cid],
    enabled: !!cid && !cid.startsWith("local:"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      if (!cid) return null;
      const res = await fetch(ipfsGatewayUrl(cid));
      if (!res.ok) throw new Error(`ipfs ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json") || ct.includes("text/json")) return res.json();
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  });
}

/** Extract a best-effort human summary from an arbitrary IPFS receipt JSON. */
export function summaryFromReport(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  for (const k of ["summary", "headline", "sessionGoal", "stroke", "title"]) {
    const v = j[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export type TechniqueReferenceView = {
  tip: string;
  sourceUrl: string | null;
  receiptUrl: string | null;
};

/** Best-effort extraction of the verified technique reference from receipt JSON. */
export function techniqueReferenceFromJson(json: unknown): TechniqueReferenceView | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const ref =
    j["techniqueReference"] && typeof j["techniqueReference"] === "object"
      ? (j["techniqueReference"] as Record<string, unknown>)
      : null;
  if (!ref) return null;
  const tip = typeof ref["tip"] === "string" ? ref["tip"].trim() : "";
  if (!tip) return null;
  const sourceUrl =
    typeof ref["sourceUrl"] === "string" && ref["sourceUrl"].startsWith("http")
      ? ref["sourceUrl"]
      : null;
  const somnia =
    ref["somnia"] && typeof ref["somnia"] === "object"
      ? (ref["somnia"] as Record<string, unknown>)
      : null;
  const url = somnia?.["receiptUrl"];
  const receiptUrl = typeof url === "string" && url.startsWith("http") ? url : null;
  return { tip, sourceUrl, receiptUrl };
}

/** Best-effort extraction of Somnia consensus receipt URL from receipt JSON. */
export function somniaReceiptUrlFromJson(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const provenance =
    j["provenance"] && typeof j["provenance"] === "object"
      ? (j["provenance"] as Record<string, unknown>)
      : null;
  if (!provenance) return null;
  const somnia =
    provenance["somnia"] && typeof provenance["somnia"] === "object"
      ? (provenance["somnia"] as Record<string, unknown>)
      : null;
  const url = somnia?.["receiptUrl"];
  return typeof url === "string" && url.startsWith("http") ? url : null;
}
