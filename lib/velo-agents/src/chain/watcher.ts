import { ethers } from "ethers";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { sleep } from "../utils/retry.js";
import { getOrchestrator, getProvider } from "./contracts.js";
import type { JobEvent, FormReceiptEvent } from "./abi.js";

const log = makeLogger("watcher");

const WS_HANDSHAKE_MS = 8_000;

export type JobRequestedHandler = (event: JobEvent) => Promise<void>;
export type FormReceiptHandler = (event: FormReceiptEvent) => Promise<void>;

interface WatcherHandlers {
  onJobRequested: JobRequestedHandler;
  onFormReceiptSubmitted: FormReceiptHandler;
}

/**
 * Somnia docs: wss://dream-rpc.somnia.network/ws
 * Bare host URLs often return 502 on the WS upgrade handshake.
 */
function normalizeSomniaWsUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("/ws") || trimmed.endsWith("/ws/")) {
    return trimmed.replace(/\/$/, "");
  }
  const base = trimmed.replace(/\/$/, "");
  return `${base}/ws`;
}

/** Prevent duplicate handler runs when polling + WS both see the same log. */
function withDedupe(handlers: WatcherHandlers): WatcherHandlers {
  const seenJobs = new Set<string>();
  const seenForms = new Set<string>();

  return {
    onJobRequested: async (event) => {
      const key = event.jobId.toLowerCase();
      if (seenJobs.has(key)) return;
      seenJobs.add(key);
      await handlers.onJobRequested(event);
    },
    onFormReceiptSubmitted: async (event) => {
      const key = event.jobId.toLowerCase();
      if (seenForms.has(key)) return;
      seenForms.add(key);
      await handlers.onFormReceiptSubmitted(event);
    },
  };
}

/**
 * Event watcher for Somnia testnet.
 *
 * - HTTP polling is always on (source of truth; survives RPC WS 502s).
 * - WebSocket is optional (`WATCHER_USE_WEBSOCKET=true`) and best-effort only.
 */
export async function startWatcher(handlers: WatcherHandlers): Promise<() => void> {
  const safe = withDedupe(handlers);

  log.info("Starting HTTP polling (source of truth)…");
  const stopPolling = await startPollingWatcher(safe);

  let stopWs: (() => void | Promise<void>) | null = null;

  const wsUrl = config.watcher.useWebSocket
    ? normalizeSomniaWsUrl(config.somnia.wsUrl)
    : null;

  if (wsUrl) {
    log.info("Attempting optional WebSocket acceleration…", { url: wsUrl });
    stopWs = await tryStartWebSocketWatcher(safe, wsUrl);
    if (stopWs) {
      log.info("WebSocket acceleration active (polling still running)");
    } else {
      log.info("WebSocket unavailable — polling only (this is normal on Somnia testnet)");
    }
  } else if (config.somnia.wsUrl.trim()) {
    log.info(
      "SOMNIA_WS_URL is set but WATCHER_USE_WEBSOCKET is false — using polling only",
    );
  }

  return async () => {
    if (stopWs) await stopWs();
    await stopPolling();
  };
}

// ── WebSocket (optional) ─────────────────────────────────────────────────────

function attachLowLevelWsError(
  provider: ethers.WebSocketProvider,
  onError: (err: unknown) => void,
): void {
  const ws = (provider as unknown as { websocket?: { on?: (e: string, fn: (err: unknown) => void) => void } })
    .websocket;
  ws?.on?.("error", onError);
}

async function tryStartWebSocketWatcher(
  handlers: WatcherHandlers,
  wsUrl: string,
): Promise<(() => void | Promise<void>) | null> {
  let wsProvider: ethers.WebSocketProvider | null = null;
  let tornDown = false;

  const teardown = async () => {
    if (tornDown || !wsProvider) return;
    tornDown = true;
    try {
      await wsProvider.destroy();
    } catch {
      /* ignore */
    }
    wsProvider = null;
  };

  try {
    wsProvider = new ethers.WebSocketProvider(wsUrl, {
      chainId: config.somnia.chainId,
      name: "somniaTestnet",
    });
  } catch (err) {
    log.warn("WebSocket provider construction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const provider = wsProvider;

  return await new Promise<(() => void | Promise<void>) | null>((resolve) => {
    let settled = false;
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (stop: (() => void | Promise<void>) | null) => {
      if (settled) return;
      settled = true;
      if (handshakeTimer) clearTimeout(handshakeTimer);
      resolve(stop);
    };

    const onWsFailure = (reason: string, err?: unknown) => {
      log.warn(`${reason} — continuing with polling only`, {
        error: err instanceof Error ? err.message : err ? String(err) : undefined,
      });
      void teardown();
      finish(null);
    };

    attachLowLevelWsError(provider, (err) => onWsFailure("WebSocket low-level error", err));

    provider.on("error", (err) => onWsFailure("WebSocket provider error", err));

    void Promise.race([
      provider.getNetwork(),
      new Promise<never>((_, reject) => {
        handshakeTimer = setTimeout(
          () => reject(new Error("WebSocket handshake timeout")),
          WS_HANDSHAKE_MS,
        );
      }),
    ])
      .then(() => {
        if (tornDown) {
          finish(null);
          return;
        }

        const orch = getOrchestrator(provider);

        orch.on(
          orch.filters.JobRequested(),
          (jobId, coach, athlete, videoCid, fee, deadline) => {
            log.info("WS: JobRequested", { jobId, athlete, videoCid });
            handlers
              .onJobRequested({
                jobId,
                coach,
                athlete,
                videoCid,
                fee: BigInt(fee),
                deadline: BigInt(deadline),
              })
              .catch((err) => log.error("onJobRequested handler error", err));
          },
        );

        orch.on(
          orch.filters.FormReceiptSubmitted(),
          (jobId, agent, ipfsCid, summaryHash, summary) => {
            log.info("WS: FormReceiptSubmitted", { jobId, agent });
            handlers
              .onFormReceiptSubmitted({ jobId, agent, ipfsCid, summaryHash, summary })
              .catch((err) => log.error("onFormReceiptSubmitted handler error", err));
          },
        );

        finish(async () => {
          await teardown();
          log.info("WebSocket watcher stopped");
        });
      })
      .catch((err: unknown) => onWsFailure("WebSocket ready failed", err));
  });
}

// ── HTTP polling ─────────────────────────────────────────────────────────────

async function startPollingWatcher(handlers: WatcherHandlers): Promise<() => void> {
  const provider = getProvider();
  const orch = getOrchestrator(provider);
  const orchAddress = config.contracts.orchestrator;

  let lastBlock =
    config.watcher.startBlock > 0
      ? config.watcher.startBlock
      : (await provider.getBlockNumber()) - 1;

  log.info(`Polling from block ${lastBlock} (interval=${config.watcher.pollIntervalMs}ms)`);

  let running = true;

  const poll = async () => {
    while (running) {
      try {
        const current = await provider.getBlockNumber();
        if (current <= lastBlock) {
          await sleep(config.watcher.pollIntervalMs);
          continue;
        }

        const fromBlock = lastBlock + 1;
        const toBlock = current;

        const jobLogs = await provider.getLogs({
          address: orchAddress,
          topics: [ethers.id("JobRequested(bytes32,address,address,string,uint256,uint64)")],
          fromBlock,
          toBlock,
        });

        for (const raw of jobLogs) {
          try {
            const parsed = orch.interface.parseLog({
              topics: raw.topics as string[],
              data: raw.data,
            });
            if (!parsed) continue;
            const { jobId, coach, athlete, videoCid, fee, deadline } = parsed.args;
            log.info("POLL: JobRequested", {
              jobId,
              athlete,
              videoCid,
              block: raw.blockNumber,
            });
            await handlers.onJobRequested({
              jobId,
              coach,
              athlete,
              videoCid,
              fee: BigInt(fee),
              deadline: BigInt(deadline),
            });
          } catch (err) {
            log.error("Failed to parse JobRequested log", err);
          }
        }

        const formLogs = await provider.getLogs({
          address: orchAddress,
          topics: [ethers.id("FormReceiptSubmitted(bytes32,address,string,bytes32,string)")],
          fromBlock,
          toBlock,
        });

        for (const raw of formLogs) {
          try {
            const parsed = orch.interface.parseLog({
              topics: raw.topics as string[],
              data: raw.data,
            });
            if (!parsed) continue;
            const { jobId, agent, ipfsCid, summaryHash, summary } = parsed.args;
            log.info("POLL: FormReceiptSubmitted", {
              jobId,
              agent,
              block: raw.blockNumber,
            });
            await handlers.onFormReceiptSubmitted({
              jobId,
              agent,
              ipfsCid,
              summaryHash,
              summary,
            });
          } catch (err) {
            log.error("Failed to parse FormReceiptSubmitted log", err);
          }
        }

        lastBlock = toBlock;
      } catch (err) {
        log.warn("Poll error — retrying", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await sleep(config.watcher.pollIntervalMs);
    }
  };

  poll();

  return () => {
    running = false;
    log.info("Polling watcher stopped");
  };
}
