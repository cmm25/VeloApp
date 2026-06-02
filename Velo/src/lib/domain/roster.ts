import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureUploadSession } from "@/lib/web3/uploader";

/**
 * Coach roster + athlete-invite client. All authed routes reuse the existing
 * SIWE upload session token from `ensureUploadSession()` (HMAC, ~1h TTL,
 * cached in sessionStorage). Public reads use plain fetch.
 */

const API_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

export type RosterEntry = {
  id: number;
  coachAddress: string;
  athleteAddress: string;
  label: string | null;
  athleteName: string | null;
  source: string;
  inviteId: string | null;
  createdAt: string;
  acceptedAt: string | null;
  status: "active" | "pending";
};

export type RosterRequest = {
  id: number;
  coachAddress: string;
  coachName: string | null;
  label: string | null;
  source: string;
  createdAt: string;
};

export type CoachLink = {
  coachAddress: string;
  coachName: string | null;
  source: string;
  createdAt: string;
};

// Coach: roster

export function useCoachRoster(enabled: boolean) {
  return useQuery({
    queryKey: ["coach-roster"],
    enabled,
    queryFn: async (): Promise<RosterEntry[]> => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/roster`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`roster_list_${res.status}`);
      const body = (await res.json()) as { roster: RosterEntry[] };
      return body.roster;
    },
  });
}

export function useAddRosterByAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { athleteAddress: string; label?: string }) => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `roster_add_${res.status}`);
      }
      return (await res.json()) as { entry: RosterEntry };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-roster"] }),
  });
}

export function useRemoveRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (athleteAddress: string) => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/roster/${athleteAddress.toLowerCase()}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`roster_remove_${res.status}`);
      return (await res.json()) as { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-roster"] }),
  });
}

// Coach: outgoing pending roster adds

export function useCoachPendingRoster(enabled: boolean) {
  return useQuery({
    queryKey: ["coach-roster-pending"],
    enabled,
    queryFn: async (): Promise<RosterEntry[]> => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/roster/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`roster_pending_${res.status}`);
      const body = (await res.json()) as { pending: RosterEntry[] };
      return body.pending;
    },
  });
}

// Athlete: my coaches

export function useMyCoaches(enabled: boolean) {
  return useQuery({
    queryKey: ["my-coaches"],
    enabled,
    queryFn: async (): Promise<CoachLink[]> => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/me/coaches`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`my_coaches_${res.status}`);
      const body = (await res.json()) as { coaches: CoachLink[] };
      return body.coaches;
    },
  });
}

// Public: coaches for an athlete

export function useCoachesForAthlete(address: string | undefined) {
  return useQuery({
    queryKey: ["coaches-for-athlete", address?.toLowerCase()],
    enabled: !!address,
    queryFn: async (): Promise<CoachLink[]> => {
      const res = await fetch(`${API_BASE}/roster/coaches/${address!.toLowerCase()}`);
      if (!res.ok) throw new Error(`coaches_for_athlete_${res.status}`);
      const body = (await res.json()) as { coaches: CoachLink[] };
      return body.coaches;
    },
  });
}

// Athlete: incoming pending roster requests

export function useMyRosterRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["my-roster-requests"],
    enabled,
    queryFn: async (): Promise<RosterRequest[]> => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/me/roster-requests`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`roster_requests_${res.status}`);
      const body = (await res.json()) as { requests: RosterRequest[] };
      return body.requests;
    },
  });
}

export function useAcceptRosterRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/me/roster-requests/${id}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`roster_accept_${res.status}`);
      return (await res.json()) as { ok: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-roster-requests"] });
      qc.invalidateQueries({ queryKey: ["my-coaches"] });
    },
  });
}

export function useDeclineRosterRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/me/roster-requests/${id}/decline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`roster_decline_${res.status}`);
      return (await res.json()) as { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-roster-requests"] }),
  });
}
