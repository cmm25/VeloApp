import { Router, type Request, type Response } from "express";
import { getReceipt, listReceipts } from "../store.js";
import { config } from "../../utils/config.js";

const router = Router();

/**
 * GET /api/receipts/:jobId
 *
 * Returns the indexed form + prescription receipts for a job.
 * This is what the frontend's indexer.ts calls to display results
 * without reading raw chain events.
 *
 * Response shape mirrors the RawResponse type in Velo/src/lib/web3/indexer.ts
 */
router.get("/:jobId", async (req: Request, res: Response) => {
  const { jobId } = req.params;

  if (!jobId || !jobId.startsWith("0x")) {
    res.status(400).json({ error: "Invalid jobId — must be a 0x-prefixed bytes32 hex" });
    return;
  }

  const stored = await getReceipt(jobId);
  if (!stored) {
    res.status(404).json({ error: "Job not found in receipt index" });
    return;
  }

  res.json({
    jobId: stored.jobId,
    orchestrator: stored.orchestrator,
    chainId: stored.chainId,
    form: stored.form
      ? {
          receipt: stored.form.receipt,
          signature: stored.form.signature,
          txHash: stored.form.txHash,
          blockNumber: stored.form.blockNumber,
          report: stored.form.report ?? null,
          provenance: stored.form.provenance ?? null,
          explorerUrl: explorerTxUrl(stored.form.txHash),
        }
      : null,
    prescription: stored.prescription
      ? {
          receipt: stored.prescription.receipt,
          signature: stored.prescription.signature,
          txHash: stored.prescription.txHash,
          blockNumber: stored.prescription.blockNumber,
          report: stored.prescription.report ?? null,
          provenance: stored.prescription.provenance ?? null,
          explorerUrl: explorerTxUrl(stored.prescription.txHash),
        }
      : null,
  });
});

/**
 * GET /api/receipts
 * Returns all indexed jobs (for admin/debug purposes)
 */
router.get("/", (_req: Request, res: Response) => {
  const all = listReceipts();
  res.json({ count: all.length, jobs: all.map((r) => r.jobId) });
});

function explorerTxUrl(txHash: string): string {
  return `https://shannon-explorer.somnia.network/tx/${txHash}`;
}

export default router;
