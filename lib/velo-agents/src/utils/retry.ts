import { makeLogger } from "./logger.js";

const log = makeLogger("retry");

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoff?: number;
  onError?: (err: unknown, attempt: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { attempts = 3, delayMs = 1000, backoff = 2, onError } = opts;
  let delay = delayMs;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      onError?.(err, i);
      if (i === attempts) throw err;
      log.warn(`Attempt ${i}/${attempts} failed. Retrying in ${delay}ms…`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delay);
      delay = Math.round(delay * backoff);
    }
  }
  throw new Error("unreachable");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
