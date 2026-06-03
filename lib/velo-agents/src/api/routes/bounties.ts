import { Router, type Request, type Response } from "express";
import { getReceipt } from "../store.js";

const router = Router();

/**
 * GET /api/bounties/:bountyId
 *
 * Returns the AI report produced after a bounty was accepted and settled.
 * `bountyId` is a plain decimal integer (e.g. "1", "42").
 *
 * The bounty agent stores results under the same jobId scheme as the
 * orchestrator: jobId = bytes32(bountyId), i.e. the uint256 zero-padded
 * to 32 bytes. We reconstruct that key here to look up in the receipt store.
 *
 * Response shape:
 * {
 *   bountyId: string,            // decimal
 *   jobId: string,               // 0x-prefixed bytes32 hex (the store key)
 *   status: "pending" | "settled",
 *   form: {
 *     receipt: { ... },
 *     txHash: string,
 *     blockNumber: string,
 *     report: FormReport | null,
 *     provenance: { ... } | null,
 *     explorerUrl: string,
 *   } | null,
 * }
 */
router.get("/:bountyId", async (req: Request, res: Response) => {
  const raw = Array.isArray(req.params.bountyId) ? req.params.bountyId[0] : (req.params.bountyId ?? "");

  let bountyIdNum: bigint;
  try {
    bountyIdNum = BigInt(raw);
    if (bountyIdNum <= 0n) throw new Error("out of range");
  } catch {
    res.status(400).json({ error: "bountyId must be a positive integer" });
    return;
  }

  // Convert to bytes32 hex — mirrors Solidity `bytes32(bountyId)`
  const jobId = "0x" + bountyIdNum.toString(16).padStart(64, "0");

  const stored = await getReceipt(jobId);

  if (!stored || !stored.form) {
    res.status(404).json({
      bountyId: raw,
      jobId,
      status: "pending",
      form: null,
    });
    return;
  }

  res.json({
    bountyId: raw,
    jobId,
    status: "settled",
    form: {
      receipt: stored.form.receipt,
      txHash: stored.form.txHash,
      blockNumber: stored.form.blockNumber,
      report: stored.form.report ?? null,
      provenance: stored.form.provenance ?? null,
      explorerUrl: `https://shannon-explorer.somnia.network/tx/${stored.form.txHash}`,
    },
  });
});

export default router;
