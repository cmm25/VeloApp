import { Router, type Request, type Response } from "express";
import { ethers } from "ethers";
import * as jose from "jose";
import { config } from "../../utils/config.js";
import { makeLogger } from "../../utils/logger.js";

const router = Router();
const log = makeLogger("auth");

const secret = new TextEncoder().encode(config.api.secret);

// In-memory nonce store (simple, sufficient for hackathon)
const _nonces = new Map<string, { nonce: string; exp: number }>();

// ── GET /api/auth/nonce ───────────────────────────────────────────────────────
router.get("/nonce", (_req: Request, res: Response) => {
  const nonce = ethers.hexlify(ethers.randomBytes(16));
  const exp = Math.floor(Date.now() / 1000) + 300; // 5 min
  _nonces.set(nonce, { nonce, exp });

  const message = buildMessage(nonce);
  res.json({ nonce, message });
});

// ── POST /api/auth/verify ─────────────────────────────────────────────────────
router.post("/verify", async (req: Request, res: Response) => {
  const { address, message, signature } = req.body as {
    address?: string;
    message?: string;
    signature?: string;
  };

  if (!address || !message || !signature) {
    res.status(400).json({ error: "address, message, and signature required" });
    return;
  }

  // Extract and validate nonce from message
  const nonceMatch = message.match(/Nonce: (0x[0-9a-f]+)/i);
  if (!nonceMatch) {
    res.status(400).json({ error: "Invalid message format — nonce not found" });
    return;
  }
  const nonce = nonceMatch[1];
  const stored = _nonces.get(nonce);
  if (!stored || stored.exp < Math.floor(Date.now() / 1000)) {
    res.status(401).json({ error: "Nonce expired or not found" });
    return;
  }
  _nonces.delete(nonce); // one-time use

  // Recover signer
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

  // Issue JWT
  const exp = Math.floor(Date.now() / 1000) + config.api.sessionTtl;
  const token = await new jose.SignJWT({ address: address.toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret);

  log.info("Session issued", { address, exp: new Date(exp * 1000).toISOString() });
  res.json({ token, exp });
});

function buildMessage(nonce: string): string {
  return [
    "Velo Agent Platform",
    "",
    "Sign this message to authenticate your upload session.",
    `Nonce: ${nonce}`,
    `Issued at: ${new Date().toISOString()}`,
  ].join("\n");
}

// ── Middleware: verify JWT ────────────────────────────────────────────────────
export async function requireAuth(
  req: Request,
  res: Response,
  next: () => void
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization header required" });
    return;
  }
  try {
    const { payload } = await jose.jwtVerify(auth.slice(7), secret);
    (req as Request & { walletAddress: string }).walletAddress = payload.address as string;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export default router;
