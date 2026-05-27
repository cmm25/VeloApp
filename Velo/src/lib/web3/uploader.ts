/**
 * Storage adapter boundary. Today: Pinata via a server-issued presigned URL.
 * Swap-in target: Supabase Storage (or Supabase-fronted Pinata).
 *
 * `PINATA_JWT` lives only on the server; the browser only ever sees the
 * presigned upload URL it returns.
 *
 * Auth: the sign-upload endpoint requires a short-lived SIWE-style session
 * token. `ensureUploadSession()` reuses a cached token from sessionStorage,
 * or asks the connected wallet to sign a one-time login message to mint one.
 */

import { getAccount, signMessage } from "@wagmi/core";
import { wagmiConfig } from "@/lib/web3/wagmi";

export type UploadProgress = (pct: number) => void;

export type UploadResult = {
  cid: string;
  /** True when no Pinata JWT was configured — CID is a deterministic
   *  `local:<sha256>` placeholder, not real IPFS. */
  demo: boolean;
  size: number;
  filename: string;
};

const apiBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

// Caller-supplied policy hints. Server is still the source of truth.
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------- Session token ----------

type CachedSession = { token: string; exp: number; address: string };
const SESSION_KEY = "velo:upload-session:v1";

function readCachedSession(address: string): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CachedSession;
    if (s.address.toLowerCase() !== address.toLowerCase()) return null;
    // 30s safety margin against clock skew / in-flight requests.
    if (s.exp * 1000 - 30_000 < Date.now()) return null;
    return s.token;
  } catch {
    return null;
  }
}

function writeCachedSession(s: CachedSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* sessionStorage unavailable — ignore, token just won't be cached */
  }
}

export async function ensureUploadSession(): Promise<{ token: string; address: string }> {
  const acct = getAccount(wagmiConfig);
  const address = acct.address;
  if (!address || !acct.isConnected) {
    throw new Error("Connect your wallet to upload");
  }

  const cached = readCachedSession(address);
  if (cached) return { token: cached, address };

  // 1. Fetch a server-issued nonce + message.
  const nonceRes = await fetch(`${apiBase}/auth/nonce`, { method: "GET" });
  if (!nonceRes.ok) throw new Error(`auth nonce failed: ${nonceRes.status}`);
  const { message } = (await nonceRes.json()) as { message: string };

  // 2. Personal_sign the message with the connected wallet.
  const signature = await signMessage(wagmiConfig, { account: address, message });

  // 3. Exchange the signature for a session token.
  const verifyRes = await fetch(`${apiBase}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, message, signature }),
  });
  if (!verifyRes.ok) throw new Error(`auth verify failed: ${verifyRes.status}`);
  const { token, exp } = (await verifyRes.json()) as { token: string; exp: number };

  writeCachedSession({ token, exp, address });
  return { token, address };
}

// ---------- Upload ----------

export async function uploadVideo(
  file: File,
  onProgress?: UploadProgress,
): Promise<UploadResult> {
  // Cheap client-side guards. Server enforces these again.
  if (!file.type.startsWith("video/")) {
    throw new Error("Only video/* uploads are allowed");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`);
  }

  // 0. Acquire a SIWE session token (cached across uploads).
  const { token } = await ensureUploadSession();

  // 1. Ask server for a Pinata presigned upload URL.
  const signRes = await fetch(`${apiBase}/pinata/sign-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      filename: file.name,
      size: file.size,
      contentType: file.type,
    }),
  });
  if (signRes.status === 401) {
    // Token might have expired between cache check and request. Drop it and
    // bubble a clearer error — caller can retry.
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    throw new Error("upload session expired — try again");
  }
  if (!signRes.ok) {
    throw new Error(`upload sign failed: ${signRes.status}`);
  }
  const sign = (await signRes.json()) as
    | { mode: "pinata"; uploadUrl: string }
    | { mode: "demo" };

  // 2. Demo mode — no PINATA_JWT on the server. Deterministic local CID.
  if (sign.mode === "demo") {
    onProgress?.(10);
    const buf = await file.arrayBuffer();
    onProgress?.(80);
    const hash = await sha256Hex(buf);
    onProgress?.(100);
    return {
      cid: `local:${hash}`,
      demo: true,
      size: file.size,
      filename: file.name,
    };
  }

  // 3. Real Pinata upload via XHR for progress events.
  const cid = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", sign.uploadUrl);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText);
          const c =
            json?.data?.cid ?? json?.IpfsHash ?? json?.cid ?? null;
          if (!c) reject(new Error("Pinata response missing CID"));
          else resolve(c as string);
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`Pinata upload failed: ${xhr.status} ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Pinata upload network error"));
    const fd = new FormData();
    fd.append("file", file);
    fd.append("network", "public");
    xhr.send(fd);
  });

  return { cid, demo: false, size: file.size, filename: file.name };
}

export function ipfsGatewayUrl(cid: string): string {
  if (cid.startsWith("local:")) return "";
  return `https://gateway.pinata.cloud/ipfs/${cid}`;
}
