import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import {
  listCoachesForAthlete,
  listAthleteRosterRequests,
  acceptRosterRequest,
  declineRosterRequest,
} from "../store.js";
import { makeLogger } from "../../utils/logger.js";

const router = Router();
const log = makeLogger("me-route");

/**
 * GET /api/me/coaches
 * Authenticated — active coaches linked to the session wallet (as athlete).
 */
router.get(
  "/coaches",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const athlete = (req as Request & { walletAddress: string }).walletAddress;
    try {
      const coaches = await listCoachesForAthlete(athlete);
      res.json({ coaches });
    } catch (err) {
      log.error("Failed to list my coaches", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * GET /api/me/roster-requests
 * Authenticated — incoming pending invites for the session wallet.
 */
router.get(
  "/roster-requests",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const athlete = (req as Request & { walletAddress: string }).walletAddress;
    try {
      const requests = await listAthleteRosterRequests(athlete);
      res.json({ requests });
    } catch (err) {
      log.error("Failed to list roster requests", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * POST /api/me/roster-requests/:id/accept
 * Authenticated — athlete accepts an invite addressed to them.
 */
router.post(
  "/roster-requests/:id/accept",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const athlete = (req as Request & { walletAddress: string }).walletAddress;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    try {
      const result = await acceptRosterRequest(id, athlete);
      if (result === "not_found") {
        res.status(404).json({ error: "Request not found" });
        return;
      }
      if (result === "forbidden") {
        res.status(403).json({ error: "Not your request" });
        return;
      }
      log.info("Roster request accepted", { athlete, id });
      res.json({ ok: true });
    } catch (err) {
      log.error("Failed to accept roster request", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

/**
 * POST /api/me/roster-requests/:id/decline
 * Authenticated — athlete declines an invite addressed to them.
 */
router.post(
  "/roster-requests/:id/decline",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const athlete = (req as Request & { walletAddress: string }).walletAddress;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    try {
      const result = await declineRosterRequest(id, athlete);
      if (result === "not_found") {
        res.status(404).json({ error: "Request not found" });
        return;
      }
      if (result === "forbidden") {
        res.status(403).json({ error: "Not your request" });
        return;
      }
      log.info("Roster request declined", { athlete, id });
      res.json({ ok: true });
    } catch (err) {
      log.error("Failed to decline roster request", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

export default router;
