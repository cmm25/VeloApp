import { useMemo } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from "wagmi";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Address, Hex, AbiEvent } from "viem";
import { getRecentLogs } from "@/lib/web3/logs";
import { veloOrchestratorAbi, athleteSbtAbi } from "@/lib/web3/abis";
import { deployment } from "@/lib/web3/deployment";
import { somniaTestnet } from "@/lib/web3/chain";
import { decodeJobSpec } from "@/lib/domain/jobSpec";

export type JobStatus =
  | "None"
  | "Requested"
  | "FormSubmitted"
  | "Completed"
  | "Cancelled";

const STATUS_NAMES: JobStatus[] = [
  "None",
  "Requested",
  "FormSubmitted",
  "Completed",
  "Cancelled",
];

export type Job = {
  jobId: Hex;
  coach: Address;
  athlete: Address;
  videoCid: string;
  fee: bigint;
  createdAt: bigint;
  deadline: bigint;
  status: JobStatus;
};

export type Receipt = {
  jobId: Hex;
  agent: Address;
  ipfsCid: string;
  summaryHash: Hex;
  summary: string;
  nonce: bigint;
  deadline: bigint;
  priorReceiptHash: Hex;
};

export type SbtReceiptRef = {
  jobId: Hex;
  ipfsCid: string;
  summaryHash: Hex;
  timestamp: bigint;
  formAgent: Address;
  prescriptionAgent: Address;
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
function _live(a: Address | null | undefined): Address | null {
  if (!a) return null;
  if (a.toLowerCase() === ZERO_ADDR) return null;
  return a;
}
export const orchestratorAddress = (): Address | null =>
  _live(deployment?.contracts.veloOrchestrator);
export const sbtAddress = (): Address | null =>
  _live(deployment?.contracts.athleteSBT);
export const agentRegistryAddress = (): Address | null =>
  _live(deployment?.contracts.agentRegistry);
export const reputationAddress = (): Address | null =>
  _live(deployment?.contracts.reputation);
export const bountyExtensionAddress = (): Address | null =>
  _live(deployment?.contracts.bountyExtension);

export function useIsDeployed() {
  return Boolean(deployment);
}

export function useIsOnSomnia() {
  const { chain } = useAccount();
  return chain?.id === somniaTestnet.id;
}

export function useMinJobFee() {
  const orch = orchestratorAddress();
  return useReadContract({
    address: orch ?? undefined,
    abi: veloOrchestratorAbi,
    functionName: "minJobFee",
    query: { enabled: !!orch },
  });
}

function decodeJob(jobId: Hex, raw: unknown): Job | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as {
    coach: Address;
    athlete: Address;
    videoCid: string;
    fee: bigint;
    createdAt: bigint;
    deadline: bigint;
    status: number;
  };
  return {
    jobId,
    coach: j.coach,
    athlete: j.athlete,
    // The on-chain videoCid may carry an off-chain model-routing prefix (see
    // jobSpec). Strip it here so every consumer transparently sees the raw cid.
    videoCid: decodeJobSpec(j.videoCid).videoCid,
    fee: j.fee,
    createdAt: j.createdAt,
    deadline: j.deadline,
    status: STATUS_NAMES[j.status] ?? "None",
  };
}

/** Poll cadence (ms) for the live Job Detail view. */
const LIVE_POLL_MS = 4000;

/**
 * `getFormReceipt`/`getPrescriptionReceipt` return a zero-filled struct (not a
 * revert) before a receipt is submitted, so a truthy `data` does NOT mean a
 * receipt exists. A real receipt always has a non-zero `agent`.
 */
function hasRealReceipt(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const agent = (raw as Record<string, unknown>).agent;
  return typeof agent === "string" && agent.toLowerCase() !== ZERO_ADDR;
}

export function useJob(jobId?: Hex, opts: { poll?: boolean } = {}) {
  const orch = orchestratorAddress();
  const enabled = !!orch && !!jobId;
  const q = useReadContract({
    address: orch ?? undefined,
    abi: veloOrchestratorAbi,
    functionName: "getJob",
    args: jobId ? [jobId] : undefined,
    query: {
      enabled,
      // While live, poll until the job reaches a terminal state, then stop.
      refetchInterval: opts.poll
        ? (query) => {
            const raw = query.state.data;
            if (raw === undefined || !jobId) return LIVE_POLL_MS;
            const status = decodeJob(jobId, raw)?.status;
            return status === "Completed" || status === "Cancelled"
              ? false
              : LIVE_POLL_MS;
          }
        : false,
    },
  });
  return {
    ...q,
    data: q.data && jobId ? decodeJob(jobId, q.data) : null,
  };
}

export function useFormReceipt(jobId?: Hex, opts: { poll?: boolean } = {}) {
  const orch = orchestratorAddress();
  const enabled = !!orch && !!jobId;
  return useReadContract({
    address: orch ?? undefined,
    abi: veloOrchestratorAbi,
    functionName: "getFormReceipt",
    args: jobId ? [jobId] : undefined,
    query: {
      enabled,
      retry: false,
      // Poll until a real receipt lands on-chain, then stop. Callers pass
      // `poll: false` once the job is terminal so cancelled jobs don't poll
      // forever waiting for a receipt that will never arrive.
      refetchInterval: opts.poll
        ? (query) => (hasRealReceipt(query.state.data) ? false : LIVE_POLL_MS)
        : false,
    },
  });
}

export function usePrescriptionReceipt(
  jobId?: Hex,
  opts: { poll?: boolean } = {},
) {
  const orch = orchestratorAddress();
  const enabled = !!orch && !!jobId;
  return useReadContract({
    address: orch ?? undefined,
    abi: veloOrchestratorAbi,
    functionName: "getPrescriptionReceipt",
    args: jobId ? [jobId] : undefined,
    query: {
      enabled,
      retry: false,
      // Poll until a real prescription lands on-chain, then stop. Callers pass
      // `poll: false` once the job is terminal to avoid endless polling.
      refetchInterval: opts.poll
        ? (query) => (hasRealReceipt(query.state.data) ? false : LIVE_POLL_MS)
        : false,
    },
  });
}

/**
 * My Jobs — derived from recent JobRequested logs filtered by `coach`.
 *
 * Somnia caps `eth_getLogs` at 1000-block windows, so a from-genesis scan is
 * impossible; this scans only a bounded recent window. For the authoritative,
 * scan-free history of a coach's *completed* sessions, prefer deriving job ids
 * from athlete SBT receipts (`useAthletesReceiptJobIds`) and reading them via
 * `useJobsByIds`. This hook remains for recent-activity lookups.
 */
export function useMyJobs(coach?: Address) {
  const client = usePublicClient({ chainId: somniaTestnet.id });
  const orch = orchestratorAddress();
  const enabled = !!client && !!orch && !!coach;

  const logsQ = useQuery({
    queryKey: ["velo:jobs:by-coach", orch, coach],
    enabled,
    queryFn: async () => {
      const event = veloOrchestratorAbi.find(
        (x) => x.type === "event" && x.name === "JobRequested",
      );
      if (!event) return [] as Job["jobId"][];
      const logs = await getRecentLogs(client!, {
        address: orch!,
        event: event as AbiEvent,
        args: { coach },
      });
      return logs.map((l) => (l as unknown as { args: { jobId: Hex } }).args.jobId);
    },
  });

  const jobIds = logsQ.data ?? [];

  const stateQ = useReadContracts({
    contracts: jobIds.map((jobId) => ({
      address: orch!,
      abi: veloOrchestratorAbi,
      functionName: "getJob" as const,
      args: [jobId] as const,
    })),
    query: { enabled: enabled && jobIds.length > 0 },
  });

  const jobs = useMemo<Job[]>(() => {
    if (!stateQ.data) return [];
    const out: Job[] = [];
    stateQ.data.forEach((res, i) => {
      if (res.status === "success" && res.result) {
        const j = decodeJob(jobIds[i]!, res.result);
        if (j) out.push(j);
      }
    });
    return out.sort((a, b) => Number(b.createdAt - a.createdAt));
  }, [stateQ.data, jobIds]);

  return {
    jobs,
    isLoading: logsQ.isLoading || stateQ.isLoading,
    refetch: () => {
      logsQ.refetch();
      stateQ.refetch();
    },
  };
}

/**
 * Read current on-chain state for an explicit list of jobIds.
 *
 * Unlike `useMyJobs` (which discovers ids via a lagging event-log scan), this
 * takes ids the caller already knows — e.g. locally-remembered recent jobs — so
 * a freshly-submitted job can show its real status immediately. Pass a stable
 * (memoized) array to avoid needless refetches.
 */
export function useJobsByIds(jobIds: Hex[]) {
  const orch = orchestratorAddress();
  const stateQ = useReadContracts({
    contracts: jobIds.map((jobId) => ({
      address: orch!,
      abi: veloOrchestratorAbi,
      functionName: "getJob" as const,
      args: [jobId] as const,
    })),
    query: { enabled: !!orch && jobIds.length > 0 },
  });

  const jobs = useMemo<Job[]>(() => {
    if (!stateQ.data) return [];
    const out: Job[] = [];
    stateQ.data.forEach((res, i) => {
      if (res.status === "success" && res.result) {
        const j = decodeJob(jobIds[i]!, res.result);
        if (j) out.push(j);
      }
    });
    return out;
  }, [stateQ.data, jobIds]);

  return { jobs, isLoading: stateQ.isLoading, refetch: stateQ.refetch };
}

/**
 * Read every receipt attached to an athlete's SBT.
 *
 * Pass `{ poll: true }` to auto-refresh the list while a session is in flight,
 * so a brand-new receipt appended on-chain shows up without a manual reload.
 * The caller is expected to drop `poll` back to `false` once nothing is in
 * flight (mirroring how `useJob` stops polling at a terminal state) so an idle
 * athlete page is not polling forever.
 */
export function useAthleteReceipts(
  athlete?: Address,
  opts: { poll?: boolean } = {},
) {
  const sbt = sbtAddress();
  const countQ = useReadContract({
    address: sbt ?? undefined,
    abi: athleteSbtAbi,
    functionName: "receiptCount",
    args: athlete ? [athlete] : undefined,
    query: {
      enabled: !!sbt && !!athlete,
      // While live, re-read the count so a freshly appended receipt is picked
      // up; a growing count grows the `receiptAt` batch below and the new row
      // renders on its own. Stops as soon as the caller drops `poll`.
      refetchInterval: opts.poll ? LIVE_POLL_MS : false,
    },
  });
  const count = countQ.data ? Number(countQ.data) : 0;

  const tokenIdQ = useReadContract({
    address: sbt ?? undefined,
    abi: athleteSbtAbi,
    functionName: "tokenIdOf",
    args: athlete ? [athlete] : undefined,
    query: {
      enabled: !!sbt && !!athlete,
      // The SBT is minted lazily on the athlete's first receipt; while live,
      // keep reading the id until it's non-zero so the SBT badge fills in on
      // its own, then stop.
      refetchInterval: opts.poll
        ? (query) =>
            query.state.data && (query.state.data as bigint) > 0n
              ? false
              : LIVE_POLL_MS
        : false,
    },
  });

  const listQ = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: sbt!,
      abi: athleteSbtAbi,
      functionName: "receiptAt" as const,
      args: [athlete!, BigInt(i)] as const,
    })),
    query: {
      enabled: !!sbt && !!athlete && count > 0,
      // When the count grows the batch is a new query; keep the existing rows
      // on screen while the larger batch loads so the list doesn't flash empty.
      placeholderData: keepPreviousData,
    },
  });

  const receipts = useMemo<SbtReceiptRef[]>(() => {
    if (!listQ.data) return [];
    return listQ.data
      .filter((r) => r.status === "success")
      .map((r) => r.result as unknown as SbtReceiptRef);
  }, [listQ.data]);

  return {
    tokenId: tokenIdQ.data ? (tokenIdQ.data as bigint) : 0n,
    count,
    receipts,
    isLoading: countQ.isLoading || tokenIdQ.isLoading || listQ.isLoading,
    refetch: () => {
      countQ.refetch();
      listQ.refetch();
    },
  };
}

/**
 * Discover every jobId attached to a set of athletes' SBTs, with no event scan.
 *
 * Jobs are content-hashed (no on-chain counter to enumerate) and Somnia caps
 * `eth_getLogs` at 1000 blocks, so a coach's *completed* sessions can't be found
 * by scanning `JobRequested` from genesis. The Athlete SBT, however, appends a
 * `ReceiptRef` (carrying its jobId) for every completed session, so we read each
 * athlete's `receiptCount` then multicall `receiptAt(athlete, i)` to recover the
 * full set of jobIds. The caller re-reads `getJob` on these (via `useJobsByIds`)
 * and filters to the jobs where it is the coach.
 *
 * Pass a stable (memoized) `athletes` array to avoid needless refetches.
 */
export function useAthletesReceiptJobIds(athletes: Address[]) {
  const sbt = sbtAddress();

  const countsQ = useReadContracts({
    contracts: athletes.map((a) => ({
      address: sbt!,
      abi: athleteSbtAbi,
      functionName: "receiptCount" as const,
      args: [a] as const,
    })),
    query: { enabled: !!sbt && athletes.length > 0 },
  });

  const pairs = useMemo<{ athlete: Address; index: number }[]>(() => {
    if (!countsQ.data) return [];
    const out: { athlete: Address; index: number }[] = [];
    countsQ.data.forEach((res, i) => {
      if (res.status === "success") {
        const n = Number(res.result as bigint);
        for (let k = 0; k < n; k++) out.push({ athlete: athletes[i]!, index: k });
      }
    });
    return out;
  }, [countsQ.data, athletes]);

  const refsQ = useReadContracts({
    contracts: pairs.map((p) => ({
      address: sbt!,
      abi: athleteSbtAbi,
      functionName: "receiptAt" as const,
      args: [p.athlete, BigInt(p.index)] as const,
    })),
    query: { enabled: !!sbt && pairs.length > 0, placeholderData: keepPreviousData },
  });

  const jobIds = useMemo<Hex[]>(() => {
    if (!refsQ.data) return [];
    const seen = new Set<string>();
    const out: Hex[] = [];
    refsQ.data.forEach((res) => {
      if (res.status === "success" && res.result) {
        const ref = res.result as unknown as SbtReceiptRef;
        const id = ref.jobId;
        if (id && !seen.has(id.toLowerCase())) {
          seen.add(id.toLowerCase());
          out.push(id);
        }
      }
    });
    return out;
  }, [refsQ.data]);

  return {
    jobIds,
    isLoading:
      (athletes.length > 0 && countsQ.isLoading) ||
      (pairs.length > 0 && refsQ.isLoading),
    refetch: () => {
      countsQ.refetch();
      refsQ.refetch();
    },
  };
}

export function useTokenUri(tokenId?: bigint) {
  const sbt = sbtAddress();
  return useReadContract({
    address: sbt ?? undefined,
    abi: athleteSbtAbi,
    functionName: "tokenURI",
    args: tokenId && tokenId > 0n ? [tokenId] : undefined,
    query: { enabled: !!sbt && !!tokenId && tokenId > 0n, retry: false },
  });
}

export function decodeTokenUri(uri: string | undefined): Record<string, unknown> | null {
  if (!uri || !uri.startsWith("data:application/json;base64,")) return null;
  try {
    const b64 = uri.slice("data:application/json;base64,".length);
    const json = atob(b64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function usePayJob() {
  return useWriteContract();
}

export function useCancelExpired() {
  return useWriteContract();
}

export function useWithdraw() {
  return useWriteContract();
}
