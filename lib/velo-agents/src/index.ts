import "dotenv/config";
import { makeLogger } from "./utils/logger.js";
import { validateRequiredForAgents, config } from "./utils/config.js";
import { startServer } from "./api/server.js";
import { startWatcher } from "./chain/watcher.js";
import { handleJobRequested } from "./agents/form-agent.js";
import { handleFormReceiptSubmitted } from "./agents/prescriber-agent.js";
import { handleBountyAccepted } from "./agents/bounty-agent.js";
import { registerAgentsOnChain } from "./chain/contracts.js";

const log = makeLogger("runner");

// WebSocket handshake failures on Somnia are async; log instead of crashing the runner.
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection (runner stays up)", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

async function main() {
  log.info("═══════════════════════════════════════════════");
  log.info("  Velo Agent Runner");
  log.info("  Form Analyst + Prescriber — Somnia Testnet");
  log.info("═══════════════════════════════════════════════");

  validateRequiredForAgents();

  // Start the API server (healthz + receipt indexer + auth + pinata sign)
  await startServer();

  // Register both agents on-chain with their skills so agentsBySkill() works.
  // Safe to call every startup — skips silently if already registered.
  const apiBase = `http://localhost:${config.api.port}`;
  await registerAgentsOnChain(apiBase).catch((err) => {
    log.warn("On-chain agent registration failed (non-fatal — agents can still process jobs)", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const stopWatcher = await startWatcher({
    onJobRequested: async (event) => {
      log.info("► Job received — starting Form Agent", { jobId: event.jobId });
      try {
        await handleJobRequested(event);
      } catch (err) {
        log.error("Form Agent failed for job", {
          jobId: event.jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    onFormReceiptSubmitted: async (event) => {
      log.info("► Form receipt seen — starting Prescriber Agent", { jobId: event.jobId });
      try {
        await handleFormReceiptSubmitted(event);
      } catch (err) {
        log.error("Prescriber Agent failed for job", {
          jobId: event.jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    onBountyAccepted: async (event) => {
      log.info("► Bounty accepted — starting Bounty Agent", {
        bountyId: event.bountyId.toString(),
        leadAgent: event.leadAgent,
      });
      try {
        await handleBountyAccepted(event);
      } catch (err) {
        log.error("Bounty Agent failed", {
          bountyId: event.bountyId.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });

  log.info("Agent runner active — watching for jobs on Somnia…");

  const shutdown = async (signal: string) => {
    log.info(`${signal} received — shutting down…`);
    stopWatcher();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep the process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
