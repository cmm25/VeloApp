import { ethers } from "ethers";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { sleep } from "../utils/retry.js";
import { getOrchestrator, getProvider } from "./contracts.js";
import type { JobEvent, FormReceiptEvent } from "./abi.js";

const log = makeLogger("watcher");

export type JobRequestedHandler = (event: JobEvent) => Promise<void>;
export type FormReceiptHandler = (event: FormReceiptEvent) => Promise<void>;

interface WatcherHandlers {
  onJobRequested: JobRequestedHandler;
  onFormReceiptSubmitted: FormReceiptHandler;
}

/**
 * Hybrid event watcher:
 *   1. Tries WebSocket subscription first (fast, real-time on Somnia ~1s blocks)
 *   2. Falls back to HTTP getLogs polling if WS is unavailable or drops
 *
 * Somnia has ~1s block times so polling at 2s gives reasonable latency
 * without hammering the RPC.
 */
export async function startWatcher(handlers: WatcherHandlers): Promise<() => void> {
  log.info("Starting event watcher…");

  if (config.somnia.wsUrl) {
    log.info("Attempting WebSocket subscription…");
    try {
      const stop = await startWebSocketWatcher(handlers);
      log.info("WebSocket watcher active");
      return stop;
    } catch (err) {
      log.warn("WebSocket failed, falling back to HTTP polling", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info(`Starting HTTP polling (interval=${config.watcher.pollIntervalMs}ms)…`);
  return startPollingWatcher(handlers);
}

// ── WebSocket watcher ─────────────────────────────────────────────────────────

async function startWebSocketWatcher(handlers: WatcherHandlers): Promise<() => void> {
  const wsProvider = new ethers.WebSocketProvider(config.somnia.wsUrl, {
    chainId: config.somnia.chainId,
    name: "somniaTestnet",
  });

  const orch = getOrchestrator(wsProvider);

  orch.on(
    orch.filters.JobRequested(),
    (jobId, coach, athlete, videoCid, fee, deadline, evt) => {
      log.info("WS: JobRequested", { jobId, athlete, videoCid });
      handlers.onJobRequested({ jobId, coach, athlete, videoCid, fee: BigInt(fee), deadline: BigInt(deadline) })
        .catch((err) => log.error("onJobRequested handler error", err));
    }
  );

  orch.on(
    orch.filters.FormReceiptSubmitted(),
    (jobId, agent, ipfsCid, summaryHash, summary, evt) => {
      log.info("WS: FormReceiptSubmitted", { jobId, agent });
      handlers.onFormReceiptSubmitted({ jobId, agent, ipfsCid, summaryHash, summary })
        .catch((err) => log.error("onFormReceiptSubmitted handler error", err));
    }
  );

  // Reconnect on disconnect
  wsProvider.on("error", async (err) => {
    log.warn("WebSocket error — will attempt reconnect", { error: String(err) });
  });

  return async () => {
    await wsProvider.destroy();
    log.info("WebSocket watcher stopped");
  };
}

// ── HTTP Polling watcher ──────────────────────────────────────────────────────

async function startPollingWatcher(handlers: WatcherHandlers): Promise<() => void> {
  const provider = getProvider();
  const orch = getOrchestrator(provider);
  const orchAddress = config.contracts.orchestrator;

  let lastBlock = config.watcher.startBlock > 0
    ? config.watcher.startBlock
    : await provider.getBlockNumber() - 1;

  log.info(`Polling from block ${lastBlock}`);

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

        // JobRequested
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
            log.info("POLL: JobRequested", { jobId, athlete, videoCid, block: raw.blockNumber });
            await handlers.onJobRequested({
              jobId, coach, athlete, videoCid,
              fee: BigInt(fee),
              deadline: BigInt(deadline),
            });
          } catch (err) {
            log.error("Failed to parse JobRequested log", err);
          }
        }

        // FormReceiptSubmitted
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
            log.info("POLL: FormReceiptSubmitted", { jobId, agent, block: raw.blockNumber });
            await handlers.onFormReceiptSubmitted({
              jobId, agent, ipfsCid, summaryHash, summary,
            });
          } catch (err) {
            log.error("Failed to parse FormReceiptSubmitted log", err);
          }
        }

        lastBlock = toBlock;
      } catch (err) {
        log.warn("Poll error — retrying", { error: err instanceof Error ? err.message : String(err) });
      }

      await sleep(config.watcher.pollIntervalMs);
    }
  };

  poll(); // runs in background

  return () => {
    running = false;
    log.info("Polling watcher stopped");
  };
}
