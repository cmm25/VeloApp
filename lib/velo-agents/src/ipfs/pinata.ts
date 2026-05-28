import { ethers } from "ethers";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";

const log = makeLogger("ipfs");

export interface PinResult {
  cid: string;
  demo: boolean;
}

/**
 * Pin JSON data to Pinata (IPFS).
 * Falls back to a deterministic local:sha256 CID if PINATA_JWT is not set.
 * The local CID is still usable for testing — just not publicly accessible.
 */
export async function pinJson(data: unknown, name: string): Promise<PinResult> {
  const body = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(body);

  if (!config.ipfs.pinataJwt) {
    log.warn("No PINATA_JWT — using local CID (demo mode)");
    const hash = ethers.keccak256(bytes);
    const cid = `local:${hash.slice(2, 18)}`; // short deterministic placeholder
    log.info("Local CID generated", { name, cid });
    return { cid, demo: true };
  }

  const payload = {
    pinataContent: data,
    pinataMetadata: { name },
    pinataOptions: { cidVersion: 1 },
  };

  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.ipfs.pinataJwt}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinata pin failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as { IpfsHash: string };
  const cid = json.IpfsHash;
  log.info("Pinned to IPFS", { name, cid });
  return { cid, demo: false };
}

export function ipfsGatewayUrl(cid: string): string {
  if (cid.startsWith("local:")) return "";
  return `${config.ipfs.pinataGateway}/ipfs/${cid}`;
}

/**
 * Fetch a video from IPFS (or skip if local CID in demo mode).
 * Returns the URL the vision engine should use to fetch the video.
 * For local CIDs we return null — caller should use mock telemetry.
 */
export function resolveVideoUrl(videoCid: string): string | null {
  if (videoCid.startsWith("local:")) return null;
  return `${config.ipfs.pinataGateway}/ipfs/${videoCid}`;
}
