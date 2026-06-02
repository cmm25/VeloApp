import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import {
  createRosterInvite,
  listCoachRoster,
  listCoachPendingRoster,
  removeRosterEntry,
  listCoachesForAthlete,
} from "../store.js";
import { makeLogger } from "../../utils/logger.js";

const router = Router();
const log = makeLogger("roster-route");

const isHexAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

/**
 * GET /api/roster
 * Authenticated — the session wallet's active roster.
 */
router.get(
  "/",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const coach = (req as Request & { walletAddress: string }).walletAddress;
    try {
      const roster = await listCoachRoster(coach);
      res.json({ roster });
    } catch (err) {
      log.error("Failed to list roster", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * GET /api/roster/pending
 * Authenticated — the session wallet's outgoing pending invites.
 */
router.get(
  "/pending",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const coach = (req as Request & { walletAddress: string }).walletAddress;
    try {
      const pending = await listCoachPendingRoster(coach);
      res.json({ pending });
    } catch (err) {
      log.error("Failed to list pending roster", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * GET /api/roster/coaches/:address
 * Public — active coaches linked to the given athlete address.
 */
router.get("/coaches/:address", async (req: Request, res: Response) => {
  const address = String(req.params.address ?? "");
  if (!address || !isHexAddress(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }
  try {
    const coaches = await listCoachesForAthlete(address);
    res.json({ coaches });
  } catch (err) {
    log.error("Failed to list coaches for athlete", err);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/roster
 * Authenticated — coach invites an athlete by wallet address (pending invite).
 */
router.post(
  "/",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const coach = (req as Request & { walletAddress: string }).walletAddress;
    const { athleteAddress, label } = req.body as {
      athleteAddress?: string;
      label?: string | null;
    };

    if (!athleteAddress || !isHexAddress(athleteAddress)) {
      res.status(400).json({ error: "Invalid athlete address" });
      return;
    }
    if (athleteAddress.toLowerCase() === coach.toLowerCase()) {
      res.status(400).json({ error: "Cannot add yourself" });
      return;
    }
    if (label != null && typeof label !== "string") {
      res.status(400).json({ error: "label must be a string" });
      return;
    }
    const cleanLabel = label != null ? label.trim().slice(0, 80) || null : null;

    try {
      const entry = await createRosterInvite(coach, athleteAddress, cleanLabel);
      log.info("Roster invite created", {
        coach,
        athlete: athleteAddress.toLowerCase(),
        id: entry.id,
      });
      res.status(201).json({ entry });
    } catch (err) {
      if (err instanceof Error && err.message === "already_on_roster") {
        res.status(409).json({ error: "already_on_roster" });
        return;
      }
      log.error("Failed to create roster invite", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * DELETE /api/roster/:address
 * Authenticated — coach removes an athlete (active or pending) from their roster.
 */
router.delete(
  "/:address",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const coach = (req as Request & { walletAddress: string }).walletAddress;
    const address = String(req.params.address ?? "");
    if (!address || !isHexAddress(address)) {
      res.status(400).json({ error: "Invalid address" });
      return;
    }
    try {
      const result = await removeRosterEntry(coach, address);
      if (result === "not_found") {
        res.status(404).json({ error: "Not on roster" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      log.error("Failed to remove roster entry", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

export default router;
