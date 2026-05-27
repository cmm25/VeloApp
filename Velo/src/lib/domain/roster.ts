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

export type CoachInvite = {
  id: string;
  coachAddress: string;
  email: string;
  displayName: string;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
  claimedAddress: string | null;
  revokedAt: string | null;
};

export type CoachLink = {
  coachAddress: string;
  coachName: string | null;
  source: string;
  createdAt: string;
};

export type PublicInvite = {
  id: string;
  coachAddress: string;
  coachLabel: string | null;
  displayName: string;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
  claimedAddress: string | null;
  revokedAt: string | null;
  expired: boolean;
};

// ---------- Coach: roster ----------

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

// ---------- Coach: invites ----------

export function useCoachInvites(enabled: boolean) {
  return useQuery({
    queryKey: ["coach-invites"],
    enabled,
    queryFn: async (): Promise<CoachInvite[]> => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/invites`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`invites_list_${res.status}`);
      const body = (await res.json()) as { invites: CoachInvite[] };
      return body.invites;
    },
  });
}

export type CreateInviteResult = {
  invite: CoachInvite;
  email: { mode: "sent" | "demo"; reason?: string; id?: string };
  claimUrl: string;
};

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; displayName: string }) => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `invite_create_${res.status}`);
      }
      return (await res.json()) as CreateInviteResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-invites"] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { token } = await ensureUploadSession();
      const res = await fetch(`${API_BASE}/invites/${encodeURIComponent(id)}/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`invite_revoke_${res.status}`);
      return (await res.json()) as { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach-invites"] }),
  });
}

// ---------- Coach: outgoing pending roster adds ----------

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

// ---------- Athlete: my coaches ----------

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

// ---------- Public: coaches for an athlete ----------

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

// ---------- Athlete: incoming pending roster requests ----------

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

// ---------- Public: invite preview (claim page) ----------

export function useInviteByToken(token: string | undefined) {
  return useQuery({
    queryKey: ["invite", token],
    enabled: !!token && token.length >= 16,
    queryFn: async (): Promise<PublicInvite> => {
      const res = await fetch(`${API_BASE}/invites/by-token/${encodeURIComponent(token!)}`);
      if (res.status === 404) throw new Error("not_found");
      if (!res.ok) throw new Error(`invite_lookup_${res.status}`);
      const body = (await res.json()) as { invite: PublicInvite };
      return body.invite;
    },
    retry: false,
  });
}

// ---------- Athlete: claim invite (SIWE) ----------

export function useClaimInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { token: sess } = await ensureUploadSession();
      const res = await fetch(
        `${API_BASE}/invites/by-token/${encodeURIComponent(token)}/claim`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${sess}` },
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `invite_claim_${res.status}`);
      }
      return (await res.json()) as { ok: true; coachAddress: string; alreadyClaimed?: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-coaches"] });
    },
  });
}
