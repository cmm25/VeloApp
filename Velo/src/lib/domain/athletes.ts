import { useCallback, useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";

export type Athlete = {
  name: string;
  address: Address;
  initials: string;
  /** True only when this name was confirmed by an on-device wallet signature
   *  verified by the API server. Coach-set names start as unverified. */
  verified: boolean;
  /** ISO timestamp from the verified claim, if any. */
  verifiedAt?: string;
};

type DirectoryRecord = {
  name: string;
  verified: boolean;
  verifiedAt?: string;
  signature?: string;
};

const STORAGE_KEY = "velo:athletes:v1";
const EVENT = "velo:athletes-changed";
const API_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

type DirectoryMap = Record<string, DirectoryRecord>;

function normalizeRecord(v: unknown): DirectoryRecord | null {
  // v1 stored bare strings — treat those as unverified legacy entries.
  if (typeof v === "string") {
    const t = v.trim();
    return t ? { name: t, verified: false } : null;
  }
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const name = typeof obj["name"] === "string" ? (obj["name"] as string).trim() : "";
  if (!name) return null;
  const verified = obj["verified"] === true;
  const verifiedAt = typeof obj["verifiedAt"] === "string" ? (obj["verifiedAt"] as string) : undefined;
  const signature = typeof obj["signature"] === "string" ? (obj["signature"] as string) : undefined;
  return { name, verified, ...(verifiedAt ? { verifiedAt } : {}), ...(signature ? { signature } : {}) };
}

// ---------- localStorage cache (offline fallback) ----------
function readMap(): DirectoryMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: DirectoryMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!isAddress(k)) continue;
      const rec = normalizeRecord(v);
      if (rec) out[k.toLowerCase()] = rec;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(m: DirectoryMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  window.dispatchEvent(new CustomEvent(EVENT));
}

// ---------- in-memory shared cache + subscribers ----------
let memoryMap: DirectoryMap | null = null;
const subscribers = new Set<(m: DirectoryMap) => void>();

function getCached(): DirectoryMap {
  if (memoryMap) return memoryMap;
  memoryMap = readMap();
  return memoryMap;
}

function setCached(next: DirectoryMap, persist = true) {
  memoryMap = next;
  if (persist) writeMap(next);
  subscribers.forEach((cb) => cb(next));
}

function mergeCached(updates: DirectoryMap) {
  setCached({ ...getCached(), ...updates });
}

// ---------- API client ----------
type ApiAthlete = { address: string; name: string; updatedAt: string };

async function apiList(): Promise<DirectoryMap> {
  const res = await fetch(`${API_BASE}/athletes`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`athletes_list ${res.status}`);
  const body = (await res.json()) as { athletes?: ApiAthlete[] };
  const out: DirectoryMap = {};
  for (const a of body.athletes ?? []) {
    if (typeof a.address === "string" && isAddress(a.address) && typeof a.name === "string") {
      // The server is the canonical name source. Verified state remains a
      // local-only fact (it lives in the localStorage mirror) and is layered
      // on top of the API result during hydration.
      out[a.address.toLowerCase()] = { name: a.name, verified: false };
    }
  }
  return out;
}

async function apiUpsert(address: Address, name: string): Promise<void> {
  // PUT /athletes/:address requires the matching SIWE session — the server
  // rejects with 403 if the bearer addr doesn't match the path addr.
  const { ensureUploadSession } = await import("@/lib/web3/uploader");
  const { token } = await ensureUploadSession();
  const res = await fetch(`${API_BASE}/athletes/${address.toLowerCase()}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`athletes_upsert ${res.status}`);
}

// ---------- shared one-shot hydration ----------
let hydratePromise: Promise<void> | null = null;
function hydrate(force = false): Promise<void> {
  if (!force && hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const remote = await apiList();
      // Merge: start from the remote canonical names, then layer the local
      // mirror on top so verified flags / signatures (which are local-only)
      // and any unsynced offline writes survive hydration.
      const local = getCached();
      const merged: DirectoryMap = { ...remote };
      for (const [key, localRec] of Object.entries(local)) {
        const remoteRec = remote[key];
        if (!remoteRec) {
          // Local-only entry — keep it (offline write or local placeholder).
          merged[key] = localRec;
        } else if (localRec.verified) {
          // Local verified record wins on name+verification metadata.
          merged[key] = localRec;
        }
      }
      setCached(merged);
    } catch {
      // Network/server down — keep the local cache untouched so the UI stays
      // functional offline.
    }
  })();
  return hydratePromise;
}

// ---------- pure helpers ----------
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) {
    const p = parts[0];
    return (p[0] + (p[1] ?? "")).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function placeholderName(address: Address): string {
  return `Athlete ${address.slice(2, 6).toLowerCase()}`;
}

function toAthlete(address: Address, rec: DirectoryRecord): Athlete {
  return {
    name: rec.name,
    address,
    initials: initialsFor(rec.name),
    verified: rec.verified,
    ...(rec.verifiedAt ? { verifiedAt: rec.verifiedAt } : {}),
  };
}

/**
 * Canonical claim message — MUST stay byte-identical to the server's
 * `buildClaimMessage` in `artifacts/api-server/src/routes/athletes.ts`.
 */
export function buildClaimMessage(args: {
  address: Address;
  name: string;
  issuedAt: string;
}): string {
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

export type ClaimVerifier = (args: {
  address: Address;
  name: string;
  issuedAt: string;
  signature: `0x${string}`;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

export const verifyClaimWithServer: ClaimVerifier = async (args) => {
  try {
    const res = await fetch(`${API_BASE}/athletes/verify-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `verify_failed_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }
};

// ---------- hook ----------
export function useAthleteDirectory() {
  const [map, setMap] = useState<DirectoryMap>(() => getCached());

  useEffect(() => {
    function sync(m: DirectoryMap) {
      setMap(m);
    }
    subscribers.add(sync);
    function onStorage() {
      memoryMap = readMap();
      setMap(memoryMap);
      subscribers.forEach((cb) => cb(memoryMap!));
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, onStorage);
    void hydrate();
    return () => {
      subscribers.delete(sync);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, onStorage);
    };
  }, []);

  const list = useMemo<Athlete[]>(() => {
    return Object.entries(map)
      .filter(([k]) => isAddress(k))
      .map(([k, rec]) => toAthlete(k as Address, rec))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [map]);

  /**
   * Coach-side or anonymous upsert. The name is always recorded as PENDING
   * because no signature was produced. Verified entries are never downgraded
   * by this call. Writes optimistically to the local mirror AND syncs the
   * canonical name to the shared API directory.
   */
  const upsert = useCallback((name: string, address: Address) => {
    if (!isAddress(address)) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = address.toLowerCase();
    const existing = getCached()[key];
    if (existing?.verified) {
      // Don't overwrite a verified name with an unverified one; keep the
      // verified record intact (and skip the remote write so we don't
      // clobber the shared directory either).
      return;
    }
    mergeCached({ [key]: { name: trimmed, verified: false } });
    // Fire-and-forget sync to the server. On failure, keep the optimistic
    // value locally so the user does not lose what they typed.
    void apiUpsert(address, trimmed).catch(() => {
      // Best-effort: schedule a re-hydrate so we eventually converge if the
      // server later comes back with a different value.
      void hydrate(true).catch(() => {});
    });
  }, []);

  /**
   * Athlete-side claim. Requires a wallet signature over the canonical
   * message; the server re-derives the signer with viem. On success the
   * entry is persisted as `verified: true` and the canonical name is also
   * pushed to the shared directory so other devices see it.
   */
  const claim = useCallback(
    async (
      name: string,
      address: Address,
      signMessage: (msg: string) => Promise<`0x${string}`>,
      verifier: ClaimVerifier = verifyClaimWithServer,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!isAddress(address)) return { ok: false, error: "invalid_address" };
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: "empty_name" };
      if (trimmed.length > 80) return { ok: false, error: "name_too_long" };

      const issuedAt = new Date().toISOString();
      const message = buildClaimMessage({ address, name: trimmed, issuedAt });

      let signature: `0x${string}`;
      try {
        signature = await signMessage(message);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "signature_rejected",
        };
      }

      const result = await verifier({ address, name: trimmed, issuedAt, signature });
      if (!result.ok) return result;

      const key = address.toLowerCase();
      mergeCached({
        [key]: {
          name: trimmed,
          verified: true,
          verifiedAt: issuedAt,
          signature,
        },
      });
      // Push the verified name to the shared directory too so other devices
      // and any coach viewing the profile see it. Failure here doesn't
      // invalidate the local claim.
      void apiUpsert(address, trimmed).catch(() => {
        void hydrate(true).catch(() => {});
      });
      return { ok: true };
    },
    [],
  );

  const ensure = useCallback((address: Address): Athlete => {
    if (!isAddress(address)) {
      return toAthlete(address, { name: placeholderName(address), verified: false });
    }
    const key = address.toLowerCase();
    const current = getCached();
    if (current[key]) return toAthlete(address, current[key]);
    const rec: DirectoryRecord = { name: placeholderName(address), verified: false };
    // Seed locally only — do NOT push placeholders to the shared directory,
    // we don't want every browser to clobber real names with "Athlete xxxx".
    mergeCached({ [key]: rec });
    return toAthlete(address, rec);
  }, []);

  const resolve = useCallback(
    (address: Address | string | undefined | null): Athlete | null => {
      if (!address || typeof address !== "string" || !isAddress(address)) return null;
      const key = address.toLowerCase();
      const rec = map[key] ?? { name: placeholderName(address as Address), verified: false };
      return toAthlete(address as Address, rec);
    },
    [map],
  );

  const search = useCallback(
    (query: string): Athlete[] => {
      const q = query.trim().toLowerCase();
      if (!q) return list;
      return list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.address.toLowerCase().includes(q),
      );
    },
    [list],
  );

  return { list, resolve, search, upsert, ensure, claim };
}

/**
 * Stable lookup without subscribing to changes — useful for one-shot resolves
 * in list rows. Always returns *something*, never a bare address.
 */
export function lookupAthlete(address: Address | string | undefined | null): Athlete | null {
  if (!address || typeof address !== "string" || !isAddress(address)) return null;
  const m = getCached();
  const key = address.toLowerCase();
  const rec = m[key] ?? { name: placeholderName(address as Address), verified: false };
  return toAthlete(address as Address, rec);
}

export function seedAthlete(address: Address) {
  if (!isAddress(address)) return;
  const key = address.toLowerCase();
  const m = getCached();
  if (m[key]) return;
  mergeCached({ [key]: { name: placeholderName(address), verified: false } });
}
