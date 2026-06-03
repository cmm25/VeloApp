/**
 * Fetches the AI analysis report for a settled bounty from the agent runner's
 * `/api/bounties/:bountyId` endpoint.
 *
 * Returns null gracefully when the runner is not reachable or the bounty hasn't
 * been analysed yet (status === "pending").
 */

const apiBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

export type BountyFormIssue = {
  area: string;
  severity: "low" | "medium" | "high";
  description: string;
  cue: string;
};

export type BountyFormStrength = {
  area: string;
  observation: string;
};

export type BountyFormReport = {
  strokeType: "forehand" | "backhand" | "serve" | "volley" | "unknown";
  overallScore: number;
  issues: BountyFormIssue[];
  strengths: BountyFormStrength[];
  keyFindings: string;
  analysedAt: string;
};

export type BountyReportEntry = {
  txHash: string;
  blockNumber: string;
  report: BountyFormReport | null;
  explorerUrl: string;
};

export type BountyReportResult =
  | { status: "settled"; bountyId: string; jobId: string; form: BountyReportEntry }
  | { status: "pending"; bountyId: string; jobId: string }
  | { status: "error"; reason: string };

export async function fetchBountyReport(
  bountyId: bigint,
): Promise<BountyReportResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}/bounties/${bountyId.toString()}`, {
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    return { status: "error", reason: (err as Error).message };
  }

  const body = await res.json().catch(() => null);
  if (!body) return { status: "error", reason: `HTTP ${res.status}` };

  if (res.status === 404 || body.status === "pending") {
    return {
      status: "pending",
      bountyId: String(bountyId),
      jobId: body.jobId ?? "",
    };
  }

  if (!res.ok) {
    return { status: "error", reason: body.error ?? `HTTP ${res.status}` };
  }

  return {
    status: "settled",
    bountyId: body.bountyId,
    jobId: body.jobId,
    form: {
      txHash: body.form.txHash,
      blockNumber: body.form.blockNumber,
      report: body.form.report ?? null,
      explorerUrl: body.form.explorerUrl,
    },
  };
}
