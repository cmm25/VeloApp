import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import { listTapes, addTape, removeTape } from "../store.js";
import { makeLogger } from "../../utils/logger.js";

const router = Router();
const log = makeLogger("tapes-route");

const isHexAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

/**
 * GET /api/tapes/:address
 * Public read of an athlete's tape library.
 */
router.get("/:address", async (req: Request, res: Response) => {
  const address = String(req.params.address ?? "");
  if (!address || !isHexAddress(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }
  try {
    const tapes = await listTapes(address);
    res.json({ tapes });
  } catch (err) {
    log.error("Failed to list tapes", err);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/tapes
 * Authenticated — adds a tape owned by the session wallet.
 */
router.post(
  "/",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const address = (req as Request & { walletAddress: string }).walletAddress;
    const { cid, label, sizeBytes, contentType } = req.body as {
      cid?: string;
      label?: string | null;
      sizeBytes?: number | null;
      contentType?: string | null;
    };

    if (!cid || typeof cid !== "string" || cid.trim() === "") {
      res.status(400).json({ error: "cid is required" });
      return;
    }
    if (label != null && typeof label !== "string") {
      res.status(400).json({ error: "label must be a string" });
      return;
    }
    if (sizeBytes != null && (typeof sizeBytes !== "number" || sizeBytes < 0)) {
      res.status(400).json({ error: "sizeBytes must be a non-negative number" });
      return;
    }

    try {
      const tape = await addTape(address, {
        cid: cid.trim(),
        label: label ?? null,
        sizeBytes: sizeBytes ?? null,
        contentType: contentType ?? null,
      });
      log.info("Tape added", { address, id: tape.id, cid: tape.cid });
      res.status(201).json({ tape });
    } catch (err) {
      log.error("Failed to add tape", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * DELETE /api/tapes/:id
 * Authenticated — only the owning wallet may delete its tape.
 */
router.delete(
  "/:id",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const address = (req as Request & { walletAddress: string }).walletAddress;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid tape id" });
      return;
    }

    try {
      const result = await removeTape(id, address);
      if (result === "not_found") {
        res.status(404).json({ error: "Tape not found" });
        return;
      }
      if (result === "forbidden") {
        res.status(403).json({ error: "Not your tape" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      log.error("Failed to delete tape", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

export default router;
