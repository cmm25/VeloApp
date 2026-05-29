import { Router, type Request, type Response } from "express";
import { ethers } from "ethers";
import { requireAuth } from "./auth.js";
import { listAthletes, upsertAthlete } from "../store.js";
import { makeLogger } from "../../utils/logger.js";

const router = Router();
const log = makeLogger("athletes-route");

const isHexAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

/**
 * GET /api/athletes
 * Public read of the shared display-name directory.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const athletes = await listAthletes();
    res.json({ athletes });
  } catch (err) {
    log.error("Failed to list athletes", err);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * PUT /api/athletes/:address
 * Authenticated — the session wallet must match the path address.
 * Upserts the (unverified) display name in the shared directory.
 */
router.put(
  "/:address",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const session = (req as Request & { walletAddress: string }).walletAddress;
    const address = String(req.params.address ?? "");
    const { name } = req.body as { name?: string };

    if (!address || !isHexAddress(address)) {
      res.status(400).json({ error: "Invalid address" });
      return;
    }
    if (address.toLowerCase() !== session.toLowerCase()) {
      res.status(403).json({ error: "Session address does not match path address" });
      return;
    }
    if (!name || typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (name.trim().length > 80) {
      res.status(400).json({ error: "name too long" });
      return;
    }

    try {
      const athlete = await upsertAthlete(address, name);
      res.json({ athlete });
    } catch (err) {
      log.error("Failed to upsert athlete", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * POST /api/athletes/verify-claim
 * Public — verifies a wallet signature over the canonical claim message.
 * On success the verified name is persisted to the shared directory.
 */
router.post("/verify-claim", async (req: Request, res: Response) => {
  const { address, name, issuedAt, signature } = req.body as {
    address?: string;
    name?: string;
    issuedAt?: string;
    signature?: string;
  };

  if (!address || !isHexAddress(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }
  if (!name || typeof name !== "string" || name.trim() === "") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!issuedAt || typeof issuedAt !== "string") {
    res.status(400).json({ error: "issuedAt is required" });
    return;
  }
  if (!signature || typeof signature !== "string") {
    res.status(400).json({ error: "signature is required" });
    return;
  }

  const message = buildClaimMessage({ address, name: name.trim(), issuedAt });

  let recovered: string;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    res.status(401).json({ error: "Signature address mismatch" });
    return;
  }

  try {
    await upsertAthlete(address, name.trim());
    log.info("Athlete claim verified", { address });
    res.json({ ok: true });
  } catch (err) {
    log.error("Failed to persist verified claim", err);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * Canonical claim message — MUST stay byte-identical to the frontend's
 * `buildClaimMessage` in Velo/src/lib/domain/athletes.ts.
 */
function buildClaimMessage(args: { address: string; name: string; issuedAt: string }): string {
  return [
    "Velo · Athlete name claim",
    "",
    `Address: ${args.address.toLowerCase()}`,
    `Name: ${args.name}`,
    `Issued at: ${args.issuedAt}`,
    "",
    "Signing this message proves you control this address and authorizes",
    "the above display name. No transaction will be sent.",
  ].join("\n");
}

export default router;
