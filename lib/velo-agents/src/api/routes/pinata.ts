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
      // v3 presigned uploads: https://uploads.pinata.cloud/v3/files/sign (not api.pinata.cloud)
      // JWT must include org:files:write — see Pinata API Keys in the dashboard.
      const expiresSec = 900;
      const signBody = {
        network: "public",
        date: Math.floor(Date.now() / 1000),
        expires: expiresSec,
        filename,
        // Cap at server max, not exact file.size — multipart overhead exceeds raw bytes.
        max_file_size: MAX_UPLOAD_BYTES,
        allow_mime_types: [contentType, "video/*"],
        keyvalues: { "velo-upload": "true" },
      };

      const keyRes = await fetch("https://uploads.pinata.cloud/v3/files/sign", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.ipfs.pinataJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(signBody),
      });

      if (!keyRes.ok) {
        const t = await keyRes.text().catch(() => "");
        log.error("Pinata sign failed", { status: keyRes.status, body: t });
        const hint =
          keyRes.status === 403
            ? "Pinata JWT lacks org:files:write or is invalid — regenerate key with file upload permissions"
            : undefined;
        res.status(502).json({
          error: "Failed to get Pinata upload URL",
          ...(hint ? { hint } : {}),
        });
        return;
      }

      const keyJson = (await keyRes.json()) as { data?: string | { url?: string } };
      const uploadUrl =
        typeof keyJson.data === "string"
          ? keyJson.data
          : (keyJson.data?.url ?? null);

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
