import { config, externalModelConfigured } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { resolveVideoUrl, pinJson } from "../ipfs/pinata.js";
import { reason } from "../ai/dispatch.js";
import { buildExternalModelPrompt } from "../ai/prompts.js";
import { callExternalModel } from "../ai/external-model.js";
import { FormReportSchema } from "../ai/schemas.js";
import {
  getExternalAgentWallet,
  externalModelSkillHash,
  fetchNonce,
  fetchJob,
  submitFormReceiptTx,
} from "../chain/contracts.js";
import { buildFormReceipt, signReceipt } from "../chain/eip712.js";
import { decodeJobSpec } from "../chain/job-spec.js";
import { upsertReceipt } from "../api/store.js";
import { JobStatus, type JobEvent } from "../chain/abi.js";

const log = makeLogger("external-model-agent");

/**
 * ExternalModelAgent — a second selectable analysis agent, triggered by the same
 * JobRequested events as the Form agent. It is INERT until configured:
 *   - if EXTERNAL_MODEL_URL + AGENT_EXTERNAL_PRIVATE_KEY are unset, it returns
 *     immediately and registers nothing on-chain;
 *   - even when configured, it only acts on jobs whose coach-selected skill
 *     (decoded from the routable videoCid) matches its advertised skill.
 *
 * When it does act it follows the exact reason→pin→sign→submit shape of the
 * Form agent and submits a STANDARD form receipt, so the Prescriber and the UI
 * consume its output with no changes.
 */
export async function handleExternalJobRequested(event: JobEvent): Promise<void> {
  const { jobId, athlete, videoCid: rawVideoCid, deadline } = event;

  if (!externalModelConfigured()) {
    return; // no-op until URL + key are set
  }

  const { skill, videoCid } = decodeJobSpec(rawVideoCid);
  const mySkill = externalModelSkillHash();

  if (skill === null || skill !== mySkill) {
    log.info("Job not routed to external model — skipping", {
      jobId,
      jobSkill: skill ?? "(default)",
      mySkill,
    });
    return;
  }

  log.info("Handling JobRequested for external model", { jobId, athlete, videoCid });

  const wallet = getExternalAgentWallet();
  const agentAddress = wallet.address;
  log.info("External model agent EOA", { address: agentAddress });

  await withRetry(
    async () => {
      // Replay guard: a restart re-scans old blocks, and the external agent also
      // submits a STANDARD form receipt, so skip unless the job still awaits one.
      const job = await fetchJob(jobId);
      if (job.status !== JobStatus.Requested) {
        log.info("Job no longer in Requested state — skipping (already processed)", {
          jobId,
          status: job.status,
        });
        return;
      }

      // raw cid, routing prefix already stripped
      const videoUrl = resolveVideoUrl(videoCid);
      if (!videoUrl) {
        log.warn("Local CID detected — external model still receives the raw cid", { videoCid });
      }

      const modelOutput = await callExternalModel(videoUrl, videoCid);

      // AI translation of model output → FormReport (Somnia native → Groq)
      const prompt = buildExternalModelPrompt(modelOutput);
      const { data: formReport, provenance } = await reason({
        prompt,
        schema: FormReportSchema,
        label: "external-model-analysis",
        signer: wallet,
      });
      log.info("External model report generated", {
        score: formReport.overallScore,
        issueCount: formReport.issues.length,
        path: provenance.path,
      });

      const reportPayload = {
        type: "velo/external-model-report/v1",
        jobId,
        skill: mySkill,
        modelName: config.externalModel.name,
        modelOutput,
        formReport,
        provenance,
      };
      const { cid: ipfsCid } = await pinJson(
        reportPayload,
        `external-report-${jobId.slice(0, 10)}`
      );

      const reportBytes = new TextEncoder().encode(JSON.stringify(reportPayload));
      const nonce = await fetchNonce(agentAddress);

      const receipt = buildFormReceipt(
        jobId,
        agentAddress,
        ipfsCid,
        reportBytes,
        formReport.keyFindings,
        nonce,
        deadline
      );

      const signature = await signReceipt(wallet, receipt, config.contracts.orchestrator);
      const txReceipt = await submitFormReceiptTx(receipt, signature, wallet);

      log.info("External model form receipt submitted ✓", {
        jobId,
        txHash: txReceipt.hash,
        block: txReceipt.blockNumber,
      });

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
        log.error(`ExternalModelAgent attempt ${attempt} failed`, {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    }
  );
}
