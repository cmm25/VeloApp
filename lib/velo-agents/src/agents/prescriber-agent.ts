import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { pinJson } from "../ipfs/pinata.js";
import { reason } from "../ai/dispatch.js";
import { buildPrescriptionPrompt } from "../ai/prompts.js";
import { PrescriptionReportSchema, FormReportSchema } from "../ai/schemas.js";
import {
  getPrescriberWallet,
  fetchNonce,
  fetchFormReceipt,
  submitPrescriptionTx,
} from "../chain/contracts.js";
import {
  buildPrescriptionReceipt,
  computeReceiptDigest,
  signReceipt,
} from "../chain/eip712.js";
import { upsertReceipt, getReceipt } from "../api/store.js";
import type { FormReceiptEvent } from "../chain/abi.js";

const log = makeLogger("prescriber-agent");

/**
 * PrescriberAgent — triggered by FormReceiptSubmitted events.
 *
 * Flow:
 *   1. Call getFormReceipt(jobId) ON-CHAIN (proves reading from chain state)
 *   2. Compute priorReceiptHash = ReceiptLib.digest(formReceipt)
 *   3. Recover the full FormReport from the store (pinned IPFS, or store)
 *   4. Call Groq → Zod-validated PrescriptionReport
 *   5. Pin prescription to Pinata → ipfsCid
 *   6. Build EIP-712 Receipt with priorReceiptHash
 *   7. Read nonce, sign, submit submitPrescription()
 *   8. Store in receipt store for API server
 *
 * The priorReceiptHash binding is the core security guarantee:
 * submitPrescription() will revert with PriorReceiptMismatch unless we
 * compute the hash from the exact on-chain form receipt.
 */
export async function handleFormReceiptSubmitted(event: FormReceiptEvent): Promise<void> {
  const { jobId, agent: formAgentAddress } = event;
  log.info("Handling FormReceiptSubmitted", { jobId, formAgent: formAgentAddress });

  const wallet = getPrescriberWallet();
  const agentAddress = wallet.address;
  log.info("Prescriber EOA", { address: agentAddress });

  await withRetry(
    async () => {
      // 1. Read form receipt ON-CHAIN — this is the cryptographic proof of reading
      const formReceipt = await fetchFormReceipt(jobId);
      log.info("Form receipt read from chain", {
        jobId,
        agent: formReceipt.agent,
        ipfsCid: formReceipt.ipfsCid,
      });

      // 2. Compute priorReceiptHash — mirrors ReceiptLib.digest() exactly
      const priorReceiptHash = computeReceiptDigest(formReceipt);
      log.info("Prior receipt hash computed", { priorReceiptHash });

      // 3. Get the form report content (from store or rebuild minimal context)
      const stored = await getReceipt(jobId);
      const formReport = stored?.form?.report;

      let reportContext = formReport
        ? JSON.stringify(formReport)
        : `Summary from chain: "${formReceipt.summary}"`;

      // Parse form report from store if available, or build minimal one from summary
      const parsedFormReport = formReport ?? {
        strokeType: "unknown" as const,
        overallScore: 5,
        issues: [],
        strengths: [],
        keyFindings: formReceipt.summary,
        analysedAt: new Date().toISOString(),
      };

      // 4. AI prescription — Somnia native LLM agent (consensus) → Groq fallback
      const prompt = buildPrescriptionPrompt(parsedFormReport);
      const { data: prescriptionReport, provenance } = await reason({
        prompt,
        schema: PrescriptionReportSchema,
        label: "prescription",
        signer: wallet,
      });
      log.info("Prescription generated", {
        goal: prescriptionReport.sessionGoal,
        drillCount: prescriptionReport.drills.length,
        path: provenance.path,
        somniaRequestId: provenance.somnia?.requestId,
      });

      // 5. Pin prescription to IPFS
      const prescriptionPayload = {
        type: "velo/prescription/v1",
        jobId,
        formReceiptRef: {
          ipfsCid: formReceipt.ipfsCid,
          summaryHash: formReceipt.summaryHash,
          priorReceiptHash,
        },
        prescriptionReport,
        provenance,
      };
      const { cid: ipfsCid } = await pinJson(
        prescriptionPayload,
        `prescription-${jobId.slice(0, 10)}`
      );

      // 6. Build receipt
      const reportBytes = new TextEncoder().encode(JSON.stringify(prescriptionPayload));
      const nonce = await fetchNonce(agentAddress);

      // Prescription deadline = same as job deadline (read from chain form receipt)
      const prescriptionDeadline = formReceipt.deadline;

      const receipt = buildPrescriptionReceipt(
        jobId,
        agentAddress,
        ipfsCid,
        reportBytes,
        prescriptionReport.sessionGoal,
        nonce,
        prescriptionDeadline,
        priorReceiptHash
      );

      log.info("Prescription receipt built", {
        ipfsCid,
        nonce: nonce.toString(),
        priorReceiptHash,
      });

      // 7. Sign + submit — will revert if priorReceiptHash doesn't match on-chain
      const signature = await signReceipt(wallet, receipt, config.contracts.orchestrator);
      const txReceipt = await submitPrescriptionTx(receipt, signature, wallet);

      log.info("Prescription submitted ✓ — escrow split + SBT updated", {
        jobId,
        txHash: txReceipt.hash,
        block: txReceipt.blockNumber,
      });

      // 8. Update store
      await upsertReceipt({
        jobId,
        orchestrator: config.contracts.orchestrator,
        chainId: config.somnia.chainId,
        form: stored?.form ?? null,
        prescription: {
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
          report: prescriptionReport,
          provenance,
        },
      });
    },
    {
      attempts: 3,
      delayMs: 2000,
      onError: (err, attempt) => {
        log.error(`PrescriberAgent attempt ${attempt} failed`, {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    }
  );
}
