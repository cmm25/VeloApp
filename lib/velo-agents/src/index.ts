import "dotenv/config";
import { makeLogger } from "./utils/logger.js";
import { validateRequiredForAgents } from "./utils/config.js";
import { startServer } from "./api/server.js";
import { startWatcher } from "./chain/watcher.js";
import { handleJobRequested } from "./agents/form-agent.js";
import { handleFormReceiptSubmitted } from "./agents/prescriber-agent.js";

const log = makeLogger("runner");

async function main() {
  log.info("═══════════════════════════════════════════════");
  log.info("  Velo Agent Runner");
  log.info("  Form Analyst + Prescriber — Somnia Testnet");
  log.info("═══════════════════════════════════════════════");

  // Validate required config before starting
  validateRequiredForAgents();

  // Start the API server (healthz + receipt indexer + auth + pinata sign)
  await startServer();

  // Start the chain event watcher
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
  });

  log.info("Agent runner active — watching for jobs on Somnia…");

  // Graceful shutdown
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
