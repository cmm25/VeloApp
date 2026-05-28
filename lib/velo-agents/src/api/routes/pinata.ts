import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth.js";
import { config } from "../../utils/config.js";
import { makeLogger } from "../../utils/logger.js";

const router = Router();
const log = makeLogger("pinata-route");

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * POST /api/pinata/sign-upload
 *
 * Issues a Pinata presigned upload URL for the browser to upload directly.
 * Returns { mode: "demo" } if PINATA_JWT is not configured — the frontend
 * then generates a local SHA-256 CID client-side.
 *
 * This endpoint mirrors what the Vercel-hosted api-server provides, so the
 * same frontend uploader.ts works against both.
 */
router.post(
  "/sign-upload",
  (req, res, next) => requireAuth(req, res, next),
  async (req: Request, res: Response) => {
    const { filename, size, contentType } = req.body as {
      filename?: string;
      size?: number;
      contentType?: string;
    };

    if (!filename || !size || !contentType) {
      res.status(400).json({ error: "filename, size, and contentType required" });
      return;
    }
    if (!contentType.startsWith("video/")) {
      res.status(400).json({ error: "Only video/* uploads are allowed" });
      return;
    }
    if (size > MAX_UPLOAD_BYTES) {
      res.status(400).json({
        error: `File too large (max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`,
      });
      return;
    }

    if (!config.ipfs.pinataJwt) {
      log.warn("No PINATA_JWT — returning demo mode");
      res.json({ mode: "demo" });
      return;
    }

    try {
      // Get a Pinata presigned upload URL
      const pinataDomain = "https://uploads.pinata.cloud/v3/files";
      const keyRes = await fetch(
        `https://api.pinata.cloud/v3/files/sign?filename=${encodeURIComponent(filename)}&expires=900`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.ipfs.pinataJwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            date: Math.floor(Date.now() / 1000),
            expires: 900,
            keyvalues: { "velo-upload": "true" },
          }),
        }
      );

      if (!keyRes.ok) {
        const t = await keyRes.text().catch(() => "");
        log.error("Pinata sign failed", { status: keyRes.status, body: t });
        res.status(502).json({ error: "Failed to get Pinata upload URL" });
        return;
      }

      const keyJson = (await keyRes.json()) as { url?: string; data?: { url?: string } };
      const uploadUrl = keyJson.url ?? keyJson.data?.url ?? null;

      if (!uploadUrl) {
        res.status(502).json({ error: "Pinata did not return an upload URL" });
        return;
      }

      log.info("Pinata upload URL issued", { filename, size });
      res.json({ mode: "pinata", uploadUrl });
    } catch (err) {
      log.error("Error issuing Pinata URL", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

export default router;
