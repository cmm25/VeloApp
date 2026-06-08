import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import { pinJson } from "../ipfs/pinata.js";
import { reason } from "../ai/dispatch.js";
import { runParseWebsite, parseWebsiteConfigured } from "../ai/somnia-agents.js";
import { buildPrescriptionPrompt, buildTechniqueQueryPrompt } from "../ai/prompts.js";
import { PrescriptionReportSchema, FormReportSchema, type TechniqueReference } from "../ai/schemas.js";
import {
  getPrescriberWallet,
  fetchNonce,
  fetchFormReceipt,
  fetchJob,
  submitPrescriptionTx,
} from "../chain/contracts.js";
import {
  buildPrescriptionReceipt,
  computeReceiptDigest,
  signReceipt,
} from "../chain/eip712.js";
import { upsertReceipt, getReceipt } from "../api/store.js";
import { JobStatus, type FormReceiptEvent } from "../chain/abi.js";

const log = makeLogger("prescriber-agent");

/** Selector of `JobNotFormSubmitted()` — revert when the job already left FormSubmitted. */
const JOB_NOT_FORM_SUBMITTED_SELECTOR = "0x83478430";

/**
 * The job has already been settled (Completed) or cancelled — a prescription is
 * moot. submitPrescription() only accepts a job in FormSubmitted, so any other
 * state means another prescriber instance (or a restart) already handled it.
 */
function prescriptionMoot(status: number): boolean {
  return status === JobStatus.Completed || status === JobStatus.Cancelled;
}

/** True if a revert is the `JobNotFormSubmitted()` custom error (any ethers shape). */
function isJobNotFormSubmittedError(err: unknown): boolean {
  const e = err as {
    revert?: { name?: string };
    data?: unknown;
    error?: { data?: unknown; error?: { data?: unknown } };
    info?: { error?: { data?: unknown } };
    message?: unknown;
  };
  if (e?.revert?.name === "JobNotFormSubmitted") return true;
  const candidates = [e?.data, e?.error?.data, e?.error?.error?.data, e?.info?.error?.data];
  for (const d of candidates) {
    if (typeof d === "string" && d.toLowerCase().startsWith(JOB_NOT_FORM_SUBMITTED_SELECTOR)) {
      return true;
    }
  }
  const msg = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes(JOB_NOT_FORM_SUBMITTED_SELECTOR) || msg.includes("jobnotformsubmitted");
}

/**
 * Decide whether a failed submit is actually "someone else already finished the
 * job" rather than a real error. Authoritative check is the on-chain status; the
 * error selector is a fast path used before the extra RPC round-trip.
 */
async function prescriptionAlreadySettled(jobId: string, err: unknown): Promise<boolean> {
  if (isJobNotFormSubmittedError(err)) return true;
  try {
    const job = await fetchJob(jobId);
    return prescriptionMoot(job.status);
  } catch {
    return false;
  }
}

/**
 * PrescriberAgent — triggered by FormReceiptSubmitted events.
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
      // Idempotency / race guard. Multiple runner instances (or a restart
      // re-scanning old blocks) can react to the same FormReceiptSubmitted
      // event with the same prescriber key. Only one tx can move the job
      // FormSubmitted → Completed; the rest would revert JobNotFormSubmitted.
      // Skip up front if the job already left FormSubmitted so we neither
      // waste an AI/IPFS round-trip nor spam retries. (Requested/None are
      // left to proceed — they only mean read-after-write RPC lag, which the
      // retry below absorbs.)
      const jobAtStart = await fetchJob(jobId);
      if (prescriptionMoot(jobAtStart.status)) {
        log.info("Job already settled/cancelled — skipping prescription (no-op)", {
          jobId,
          status: jobAtStart.status,
        });
        return;
      }

      // Read form receipt ON-CHAIN — this is the cryptographic proof of reading
      const formReceipt = await fetchFormReceipt(jobId);
      log.info("Form receipt read from chain", {
        jobId,
        agent: formReceipt.agent,
        ipfsCid: formReceipt.ipfsCid,
      });

      // Compute priorReceiptHash — mirrors ReceiptLib.digest() exactly
      const priorReceiptHash = computeReceiptDigest(formReceipt);
      log.info("Prior receipt hash computed", { priorReceiptHash });

      // Get the form report content (from store or rebuild minimal context)
      const stored = await getReceipt(jobId);
      const formReport = stored?.form?.report;

      let reportContext = formReport
        ? JSON.stringify(formReport)
        : `Summary from chain: "${formReceipt.summary}"`;

      const parsedFormReport = formReport ?? {
        strokeType: "unknown" as const,
        overallScore: 5,
        issues: [],
        strengths: [],
        keyFindings: formReceipt.summary,
        analysedAt: new Date().toISOString(),
      };

      // AI prescription — Somnia native LLM agent (consensus) → Groq fallback
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

      // Ground the prescription in a real, consensus-verified coaching source via
      // Somnia's LLM Parse Website agent. Best-effort — any failure is logged and
      // skipped so it never blocks settlement.
      let techniqueReference: TechniqueReference | undefined;
      if (parseWebsiteConfigured()) {
        const sourceUrl = config.somniaAgents.techniqueSourceUrl;
        try {
          const ref = await runParseWebsite(
            buildTechniqueQueryPrompt(parsedFormReport),
            sourceUrl,
            wallet
          );
          const tip = ref.output.trim();
          if (tip) {
            techniqueReference = { tip, sourceUrl, somnia: ref.receipt };
            log.info("Technique reference attached", {
              requestId: ref.receipt.requestId,
              sourceUrl,
            });
          }
        } catch (err) {
          log.warn("Technique reference skipped", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

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
        techniqueReference,
      };
      const { cid: ipfsCid } = await pinJson(
        prescriptionPayload,
        `prescription-${jobId.slice(0, 10)}`
      );

      const reportBytes = new TextEncoder().encode(JSON.stringify(prescriptionPayload));
      const nonce = await fetchNonce(agentAddress);
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

      // Sign + submit — will revert if priorReceiptHash doesn't match on-chain
      const signature = await signReceipt(wallet, receipt, config.contracts.orchestrator);

      // Re-check immediately before submitting: the AI + IPFS work above takes
      // time, during which another prescriber may have completed the job. This
      // narrows (but cannot fully close) the race window — the catch below is the
      // authoritative backstop.
      const jobBeforeSubmit = await fetchJob(jobId);
      if (prescriptionMoot(jobBeforeSubmit.status)) {
        log.info("Job completed by another agent during analysis — skipping submit (no-op)", {
          jobId,
          status: jobBeforeSubmit.status,
        });
        return;
      }

      let txReceipt: Awaited<ReturnType<typeof submitPrescriptionTx>>;
      try {
        txReceipt = await submitPrescriptionTx(receipt, signature, wallet);
      } catch (err) {
        // Lost the race: another prescriber moved the job to Completed first, so
        // submitPrescription reverts with JobNotFormSubmitted. The session still
        // succeeded — treat it as a no-op success instead of erroring + retrying.
        if (await prescriptionAlreadySettled(jobId, err)) {
          log.info("Prescription already submitted by another agent — no-op success", { jobId });
          return;
        }
        throw err;
      }

      log.info("Prescription submitted ✓ — escrow split + SBT updated", {
        jobId,
        txHash: txReceipt.hash,
        block: txReceipt.blockNumber,
      });

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
          techniqueReference,
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
