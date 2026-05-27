/**
 * On-chain role resolution.
 *
 * The role is determined by reading two contracts in a single multicall:
 *   - `AthleteSBT.tokenIdOf(addr)` → non-zero ⇒ athlete
 *   - `CoachRegistry.isCoach(addr)` → true ⇒ coach
 *
 * Role identity is sticky: there is no client-side toggle. Switching roles
 * requires deleting the account (burn SBT or deregister coach) and
 * re-registering.
 */
import type { Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { deployment } from "@/lib/web3/deployment";
import {
  athleteSbtRoleAbi,
  coachRegistryAbi,
} from "@/lib/web3/coachRegistryAbi";

export type OnChainRole = "athlete" | "coach" | null;

export type OnChainRoleStatus = {
  role: OnChainRole;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

export function useOnChainRole(addr?: Address): OnChainRoleStatus {
  const sbt = deployment?.contracts.athleteSBT;
  const coach = deployment?.contracts.coachRegistry;
  const enabled = Boolean(addr && sbt);

  // Wagmi infers an exact tuple from the `contracts` array shape. Building
  // it conditionally trips that inference, so we cast each entry with `as
  // const`-style annotations and then erase the heterogeneous tuple to
  // `unknown[]` for the call — we narrow results manually below.
  const calls = enabled
    ? coach
      ? ([
          {
            address: sbt!,
            abi: athleteSbtRoleAbi,
            functionName: "tokenIdOf",
            args: [addr!],
          },
          {
            address: coach,
            abi: coachRegistryAbi,
            functionName: "isCoach",
            args: [addr!],
          },
        ] as const)
      : ([
          {
            address: sbt!,
            abi: athleteSbtRoleAbi,
            functionName: "tokenIdOf",
            args: [addr!],
          },
        ] as const)
    : ([] as const);

  const q = useReadContracts({
    allowFailure: true,
    // The conditional tuple confuses wagmi's deep inference; the runtime
    // shape is correct and we narrow results manually.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: calls as any,
    query: { enabled, refetchOnWindowFocus: false, retry: 1 },
  });

  let role: OnChainRole = null;
  const data = q.data as
    | ReadonlyArray<{ status: "success"; result: unknown } | { status: "failure"; error: Error }>
    | undefined;
  if (data) {
    const tokenEntry = data[0];
    const tokenId =
      tokenEntry && tokenEntry.status === "success" ? (tokenEntry.result as bigint) : 0n;
    const coachEntry = coach ? data[1] : undefined;
    const isCoachFlag =
      coachEntry && coachEntry.status === "success" ? (coachEntry.result as boolean) : false;
    if (tokenId > 0n) role = "athlete";
    else if (isCoachFlag) role = "coach";
  }

  return {
    role,
    isLoading: q.isLoading,
    error: (q.error as Error | null) ?? null,
    refetch: () => {
      q.refetch();
    },
  };
}

/** Convenience: connected-wallet role. */
export function useMyOnChainRole(): OnChainRoleStatus {
  const { address } = useAccount();
  return useOnChainRole(address);
}
