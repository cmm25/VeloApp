import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";

/**
 * Lightweight, per-coach local record of recently submitted jobs.
 *
 * The on-chain indexer (`useMyJobs`, an event-log scan) lags behind a freshly
 * created job, so a job a coach just paid for often isn't listed yet. We persist
 * a minimal pointer to it in localStorage the moment it's submitted so the coach
 * can navigate away / refresh and still find their in-progress session. The
 * authoritative status is always re-read on-chain; this is only a discoverability
 * aid, never a source of truth.
 */
export type RecentJob = {
  jobId: Hex;
  athlete: Address;
  cid?: string;
  /** ms epoch — when this job was submitted from this device. */
  createdAt: number;
};

const KEY_PREFIX = "velo:recent-jobs:";
const CHANGED_EVENT = "velo:recent-jobs-changed";
const MAX_RECENT = 12;

function keyFor(coach: string) {
  return `${KEY_PREFIX}${coach.toLowerCase()}`;
}

function read(coach?: string | null): RecentJob[] {
  if (!coach || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(coach));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (j): j is RecentJob =>
        !!j &&
        typeof j === "object" &&
        typeof (j as RecentJob).jobId === "string" &&
        typeof (j as RecentJob).athlete === "string",
    );
  } catch {
    return [];
  }
}

function write(coach: string, jobs: RecentJob[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      keyFor(coach),
      JSON.stringify(jobs.slice(0, MAX_RECENT)),
    );
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  } catch {
    /* ignore quota / serialization errors — this is a best-effort cache */
  }
}

/** Persist a freshly submitted job, newest first, de-duped by jobId. */
export function recordRecentJob(coach: string, job: RecentJob) {
  const existing = read(coach).filter(
    (j) => j.jobId.toLowerCase() !== job.jobId.toLowerCase(),
  );
  write(coach, [job, ...existing]);
}

/** Drop jobs that have settled on-chain (completed / cancelled). */
export function removeRecentJobs(coach: string, jobIds: string[]) {
  if (jobIds.length === 0) return;
  const drop = new Set(jobIds.map((j) => j.toLowerCase()));
  const existing = read(coach);
  const next = existing.filter((j) => !drop.has(j.jobId.toLowerCase()));
  if (next.length !== existing.length) write(coach, next);
}

/**
 * Reactive view of the recent-jobs record for the connected coach. Updates when
 * a job is recorded/removed in this tab (custom event) or another tab (storage
 * event).
 */
export function useRecentJobs(coach?: Address | null) {
  const [recent, setRecent] = useState<RecentJob[]>(() => read(coach));

  useEffect(() => {
    setRecent(read(coach));
    if (!coach || typeof window === "undefined") return;
    const onChange = () => setRecent(read(coach));
    // Cross-tab: only react to our own keys to avoid needless rerenders.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith(KEY_PREFIX)) setRecent(read(coach));
    };
    window.addEventListener(CHANGED_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [coach]);

  const remove = useCallback(
    (jobIds: string[]) => {
      if (coach) removeRecentJobs(coach, jobIds);
    },
    [coach],
  );

  return { recent, remove };
}
