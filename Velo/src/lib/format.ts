import type { Address, Hex } from "viem";

export const shortAddr = (a?: Address | string | null, head = 6, tail = 4) =>
  a ? `${a.slice(0, head)}…${a.slice(-tail)}` : "—";

export const shortHash = (h?: Hex | string | null) =>
  h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—";

export function formatStt(wei?: bigint): string {
  if (wei === undefined || wei === null) return "—";
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  if (frac === 0n) return `${whole.toString()} STT`;
  const fracStr = (frac + 10n ** 18n).toString().slice(1).replace(/0+$/, "");
  return `${whole}.${fracStr.slice(0, 4)} STT`;
}

export function timeUntil(deadline: bigint | number | undefined): string {
  if (!deadline) return "—";
  const ts = typeof deadline === "bigint" ? Number(deadline) : deadline;
  const now = Math.floor(Date.now() / 1000);
  let diff = ts - now;
  if (diff <= 0) return "expired";
  const d = Math.floor(diff / 86400);
  diff -= d * 86400;
  const h = Math.floor(diff / 3600);
  diff -= h * 3600;
  const m = Math.floor(diff / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function explorerTx(hash: string) {
  return `https://explorer.somnia.network/tx/${hash}`;
}

export function explorerAddr(a: string) {
  return `https://explorer.somnia.network/address/${a}`;
}
