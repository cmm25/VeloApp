/**
 * Role labels used across the UI. The role *value* itself is sourced from
 * on-chain reads — see `lib/domain/onchainRole.ts`. There is no client-side
 * role store; the on-chain answer is authoritative and sticky.
 */
export type Role = "coach" | "athlete";

export const ROLE_LABELS: Record<Role, string> = {
  coach: "Coach",
  athlete: "Athlete",
};
