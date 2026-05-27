import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isAddress, type Address } from "viem";
import { ensureUploadSession } from "@/lib/web3/uploader";

/**
 * Athlete-owned tape library client.
 *
 * Backed by the api-server `/tapes` surface. Reads are public; writes use
 * the same SIWE upload session the Pinata flow already mints, so only the
 * wallet matching the athlete address may add or remove its own tapes.
 */

export type Tape = {
  id: number;
  address: string;
  cid: string;
  label: string | null;
  sizeBytes: number | null;
  contentType: string | null;
  createdAt: string;
};

const API_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

function tapesKey(address?: Address) {
  return ["velo:tapes", address?.toLowerCase() ?? ""] as const;
}

async function listTapes(address: Address): Promise<Tape[]> {
  const res = await fetch(`${API_BASE}/tapes/${address.toLowerCase()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`tapes_list_${res.status}`);
  const body = (await res.json()) as { tapes?: Tape[] };
  return body.tapes ?? [];
}

export function useTapes(address?: Address) {
  return useQuery({
    queryKey: tapesKey(address),
    enabled: !!address && isAddress(address),
    queryFn: () => listTapes(address!),
    staleTime: 15_000,
  });
}

export function useAddTape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      cid: string;
      label?: string | null;
      sizeBytes?: number | null;
      contentType?: string | null;
    }) => {
      const { token, address } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/tapes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `tape_insert_${res.status}`);
      }
      const body = (await res.json()) as { tape: Tape };
      return { tape: body.tape, address };
    },
    onSuccess: ({ address }) => {
      qc.invalidateQueries({ queryKey: tapesKey(address as Address) });
    },
  });
}

export function useRemoveTape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; address: Address }) => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/tapes/${input.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `tape_delete_${res.status}`);
      }
      return input;
    },
    onSuccess: ({ address }) => {
      qc.invalidateQueries({ queryKey: tapesKey(address) });
    },
  });
}

export function formatTapeSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Cheap "Apr 4" style label, with year if not the current year. */
export function formatTapeDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Build a short label from a filename or CID for grid thumbnails. */
export function defaultLabelFor(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").slice(0, 60);
  return stem || filename.slice(0, 60);
}

/** Mutation helpers re-exported for convenience. */
export const tapeKeys = { list: tapesKey };
export { listTapes };
