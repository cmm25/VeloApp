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
