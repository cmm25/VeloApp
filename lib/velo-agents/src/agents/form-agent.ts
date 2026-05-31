import { ethers } from "ethers";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { resolveVideoUrl } from "../ipfs/pinata.js";
import { pinJson } from "../ipfs/pinata.js";
import { reason } from "../ai/dispatch.js";
import { buildFormAnalysisPrompt } from "../ai/prompts.js";
import { FormReportSchema, TennisTelemetrySchema, type TennisTelemetry } from "../ai/schemas.js";
import {
  getFormAgentWallet,
  fetchNonce,
  submitFormReceiptTx,
} from "../chain/contracts.js";
import {
  buildFormReceipt,
  signReceipt,
} from "../chain/eip712.js";
import { upsertReceipt } from "../api/store.js";
import type { JobEvent } from "../chain/abi.js";

const log = makeLogger("form-agent");

/**
 * FormAgent — triggered by JobRequested events.
 *
 * Flow:
 *   1. Resolve video URL from videoCid (IPFS gateway or null for local CID)
 *   2. Call velo-engine POST /analyze → TennisTelemetry
 *   3. Call Groq → Zod-validated FormReport
 *   4. Pin full report to Pinata → ipfsCid
 *   5. Build EIP-712 Receipt (priorReceiptHash = bytes32(0))
 *   6. Read nonce from chain, sign, submit submitFormReceipt()
 *   7. Store in receipt store for API server
 */
export async function handleJobRequested(event: JobEvent): Promise<void> {
  const { jobId, athlete, videoCid, deadline } = event;
  log.info("Handling JobRequested", { jobId, athlete, videoCid });

  const wallet = getFormAgentWallet();
  const agentAddress = wallet.address;
  log.info("Form agent EOA", { address: agentAddress });

  await withRetry(
    async () => {
      // 1. Resolve video URL
      const videoUrl = resolveVideoUrl(videoCid);
      if (!videoUrl) {
        log.warn("Local CID detected — using mock telemetry for demo", { videoCid });
      }

      // 2. Get pose telemetry from vision engine
      const telemetry = await fetchTelemetry(videoUrl, videoCid);
      log.info("Telemetry received", {
        stroke: telemetry.dominantStroke,
        frames: telemetry.framesAnalyzed,
        score: telemetry.symmetryScore,
      });

      // 3. AI form analysis — Somnia native LLM agent (consensus) → Groq fallback
      const prompt = buildFormAnalysisPrompt(telemetry);
      const { data: formReport, provenance } = await reason({
        prompt,
        schema: FormReportSchema,
        label: "form-analysis",
        signer: wallet,
      });
      log.info("Form report generated", {
        score: formReport.overallScore,
        issueCount: formReport.issues.length,
        path: provenance.path,
        somniaRequestId: provenance.somnia?.requestId,
      });

      // 4. Pin full report to IPFS (provenance recorded for auditability)
      const reportPayload = {
        type: "velo/form-report/v1",
        jobId,
        telemetry,
        formReport,
        provenance,
      };
      const { cid: ipfsCid } = await pinJson(reportPayload, `form-report-${jobId.slice(0, 10)}`);

      // 5. Build receipt
      const reportBytes = new TextEncoder().encode(JSON.stringify(reportPayload));
      const nonce = await fetchNonce(agentAddress);
      const receiptDeadline = deadline; // agent deadline = job deadline

      const receipt = buildFormReceipt(
        jobId,
        agentAddress,
        ipfsCid,
        reportBytes,
        formReport.keyFindings,
        nonce,
        receiptDeadline
      );

      log.info("Receipt built", {
        ipfsCid,
        summaryHash: receipt.summaryHash,
        nonce: nonce.toString(),
      });

      // 6. Sign + submit
      const signature = await signReceipt(wallet, receipt, config.contracts.orchestrator);
      const txReceipt = await submitFormReceiptTx(receipt, signature, wallet);

      log.info("Form receipt submitted ✓", {
        jobId,
        txHash: txReceipt.hash,
        block: txReceipt.blockNumber,
      });

      // 7. Store for API
      await upsertReceipt({
        jobId,
        orchestrator: config.contracts.orchestrator,
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
        log.error(`FormAgent attempt ${attempt} failed`, {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    }
  );
}

// ── Vision engine call ─────────────────────────────────────────────────────────

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
        signal: AbortSignal.timeout(120_000), // 2 min max for video processing
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

/**
 * The velo-engine (Python/Pydantic) returns telemetry with snake_case keys
 * (e.g. `stroke_phases`, `frame_index`), but the agent and the Zod schema use
 * camelCase. Convert at the boundary, then validate so any shape drift fails
 * with a descriptive error instead of a cryptic downstream crash.
 */
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

/** Recursively convert snake_case object keys to camelCase (values untouched). */
function snakeToCamelDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeToCamelDeep);
  if (value && typeof value === "object") {
    // null prototype so hostile keys like "__proto__" can't pollute prototypes
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const camelKey = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      out[camelKey] = snakeToCamelDeep(v);
    }
    return out;
  }
  return value;
}

// Mock telemetry — used when VISION_MODE=mock or video CID is local
function buildMockTelemetry(videoCid: string): TennisTelemetry {
  // Deterministic values seeded from CID for reproducibility
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

