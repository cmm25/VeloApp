import { ethers } from "ethers";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { resolveVideoUrl, pinJson } from "../ipfs/pinata.js";
import { reason } from "../ai/dispatch.js";
import { buildFormAnalysisPrompt } from "../ai/prompts.js";
import { FormReportSchema, TennisTelemetrySchema, type TennisTelemetry } from "../ai/schemas.js";
import {
  getFormAgentWallet,
  getBountyExtension,
  fetchBountyNonce,
  settleWithSplitsTx,
} from "../chain/contracts.js";
import {
  buildBountyReceipt,
  signBountyReceipt,
} from "../chain/eip712.js";
import { decodeJobSpec } from "../chain/job-spec.js";
import { upsertReceipt } from "../api/store.js";
import type { BountyAcceptedEvent } from "../chain/abi.js";

const log = makeLogger("bounty-agent");

/**
 * BountyAgent — triggered by BidAccepted events on BountyExtension.
 *
 * Only runs when the lead agent == our form agent wallet address.
 *
 * Flow:
 *   1. Fetch full bounty details from chain (videoCid, athlete, deadline)
 *   2. Resolve video URL from videoCid
 *   3. Call velo-engine POST /analyze → TennisTelemetry
 *   4. Call AI → Zod-validated FormReport
 *   5. Pin full report to Pinata → ipfsCid
 *   6. Build EIP-712 Receipt signed against BountyExtension ("VeloBounty","1") domain
 *      - jobId = bytes32(bountyId)
 *      - nonce from BountyExtension.nonceOf(agent)
 *      - priorReceiptHash = bytes32(0) (single-agent bounty)
 *   7. Call settleWithSplits(bountyId, receipt, sig, [], [], [])
 *      - Empty sub-receipts + splits → lead agent receives 100% of escrow
 *   8. Store in receipt store for API
 */
export async function handleBountyAccepted(event: BountyAcceptedEvent): Promise<void> {
  const { bountyId, leadAgent, videoCid: rawVideoCid, athlete, deadline } = event;
  // Bounties route by on-chain `requiredSkills`, so their videoCid is always the
  // raw cid. Decode defensively anyway so an encoded cid never reaches the
  // gateway resolver.
  const { videoCid } = decodeJobSpec(rawVideoCid);
  log.info("Handling BountyAccepted", { bountyId: bountyId.toString(), leadAgent, videoCid });

  const wallet = getFormAgentWallet();
  const agentAddress = wallet.address;

  if (leadAgent.toLowerCase() !== agentAddress.toLowerCase()) {
    log.info("Bounty lead agent is not our form agent — skipping", {
      bountyId: bountyId.toString(),
      leadAgent,
      ourAgent: agentAddress,
    });
    return;
  }

  if (!config.contracts.bountyExtension) {
    log.warn("BOUNTY_EXTENSION_ADDRESS not set — cannot settle bounty", {
      bountyId: bountyId.toString(),
    });
    return;
  }

  await withRetry(
    async () => {
      // 1. Resolve video URL
      const videoUrl = resolveVideoUrl(videoCid);
      if (!videoUrl) {
        log.warn("Local CID detected — using mock telemetry for bounty", { videoCid });
      }

      // 2. Get pose telemetry from vision engine
      const telemetry = await fetchTelemetry(videoUrl, videoCid);
      log.info("Telemetry received", {
        stroke: telemetry.dominantStroke,
        frames: telemetry.framesAnalyzed,
        score: telemetry.symmetryScore,
      });

      // 3. AI form analysis
      const prompt = buildFormAnalysisPrompt(telemetry);
      const { data: formReport, provenance } = await reason({
        prompt,
        schema: FormReportSchema,
        label: "bounty-form-analysis",
        signer: wallet,
      });
      log.info("Bounty form report generated", {
        score: formReport.overallScore,
        issueCount: formReport.issues.length,
        path: provenance.path,
      });

      // 4. Pin full report to IPFS
      const reportPayload = {
        type: "velo/bounty-report/v1",
        bountyId: bountyId.toString(),
        athlete,
        telemetry,
        formReport,
        provenance,
      };
      const { cid: ipfsCid } = await pinJson(
        reportPayload,
        `bounty-report-${bountyId.toString()}`
      );

      // 5. Build bounty receipt
      const reportBytes = new TextEncoder().encode(JSON.stringify(reportPayload));
      const nonce = await fetchBountyNonce(agentAddress);

      const receipt = buildBountyReceipt(
        bountyId,
        agentAddress,
        ipfsCid,
        reportBytes,
        formReport.keyFindings,
        nonce,
        deadline
      );

      log.info("Bounty receipt built", {
        ipfsCid,
        summaryHash: receipt.summaryHash,
        nonce: nonce.toString(),
        jobId: receipt.jobId,
      });

      // 6. Sign against BountyExtension domain ("VeloBounty","1")
      const signature = await signBountyReceipt(
        wallet,
        receipt,
        config.contracts.bountyExtension
      );

      // 7. Settle — no sub-agents, lead takes 100%
      const txReceipt = await settleWithSplitsTx(bountyId, receipt, signature, wallet);

      log.info("Bounty settled ✓", {
        bountyId: bountyId.toString(),
        txHash: txReceipt.hash,
        block: txReceipt.blockNumber,
      });

      // 8. Store for API
      const jobId = receipt.jobId;
      await upsertReceipt({
        jobId,
        orchestrator: config.contracts.bountyExtension,
        chainId: config.somnia.chainId,
        form: {
          receipt: {
            jobId: receipt.jobId,
            agent: receipt.agent,
            ipfsCid: receipt.ipfsCid,
            summaryHash: receipt.summaryHash,
            summary: receipt.summary,
            nonce: receipt.nonce.toString(),
            deadline: receipt.deadline.toString(),
            priorReceiptHash: receipt.priorReceiptHash,
          },
          signature,
          txHash: txReceipt.hash,
          blockNumber: txReceipt.blockNumber.toString(),
          report: formReport,
          provenance,
        },
        prescription: null,
      });
    },
    {
      attempts: 3,
      delayMs: 2000,
      onError: (err, attempt) => {
        log.error(`BountyAgent attempt ${attempt} failed`, {
          bountyId: bountyId.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      },
    }
  );
}

async function fetchTelemetry(
  videoUrl: string | null,
  videoCid: string
): Promise<TennisTelemetry> {
  if (config.vision.mode === "mock" || !videoUrl) {
    log.info("Using mock telemetry", { reason: !videoUrl ? "local CID" : "VISION_MODE=mock" });
    return buildMockTelemetry(videoCid);
  }

  const res = await withRetry(
    () =>
      fetch(`${config.vision.engineUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_url: videoUrl, video_cid: videoCid }),
        signal: AbortSignal.timeout(120_000),
      }),
    { attempts: 2, delayMs: 3000 }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vision engine error: ${res.status} ${text}`);
  }

  const raw = (await res.json()) as unknown;
  return normalizeTelemetry(raw);
}

function normalizeTelemetry(raw: unknown): TennisTelemetry {
  const camel = snakeToCamelDeep(raw);
  const result = TennisTelemetrySchema.safeParse(camel);
  if (!result.success) {
    const issues = result.error.errors
      .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
      .join("; ");
    throw new Error(`Vision engine telemetry failed validation: ${issues}`);
  }
  return result.data;
}

function snakeToCamelDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeToCamelDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const camelKey = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      out[camelKey] = snakeToCamelDeep(v);
    }
    return out;
  }
  return value;
}

function buildMockTelemetry(videoCid: string): TennisTelemetry {
  const seed = videoCid.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const vary = (base: number, range: number) =>
    base + ((seed % 100) / 100) * range - range / 2;

  return {
    videoUrl: "",
    durationMs: 42000,
    framesAnalyzed: 63,
    fps: 30,
    strokePhases: [
      {
        phase: "preparation",
        frameIndex: 8,
        timestampMs: 267,
        angles: {
          shoulder: vary(95, 15),
          elbow: vary(110, 20),
          wrist: vary(160, 15),
          hip: vary(170, 10),
          knee: vary(145, 20),
        },
      },
      {
        phase: "contact",
        frameIndex: 22,
        timestampMs: 733,
        angles: {
          shoulder: vary(145, 10),
          elbow: vary(165, 15),
          wrist: vary(175, 10),
          hip: vary(160, 10),
          knee: vary(155, 15),
        },
      },
      {
        phase: "follow_through",
        frameIndex: 38,
        timestampMs: 1267,
        angles: {
          shoulder: vary(200, 15),
          elbow: vary(145, 20),
          wrist: vary(155, 15),
          hip: vary(175, 10),
          knee: vary(165, 10),
        },
      },
    ],
    peakAngles: {
      shoulder: vary(145, 10),
      elbow: vary(168, 15),
      wrist: vary(178, 8),
      hip: vary(172, 8),
      knee: vary(158, 12),
    },
    avgAngles: {
      shoulder: vary(128, 8),
      elbow: vary(140, 12),
      wrist: vary(163, 10),
      hip: vary(168, 6),
      knee: vary(155, 10),
    },
    symmetryScore: vary(0.72, 0.2),
    dominantStroke: "forehand",
    strokeCount: 3,
    analysisNotes: "Mock telemetry — velo-engine not reachable or VISION_MODE=mock",
    isMock: true,
  };
}
