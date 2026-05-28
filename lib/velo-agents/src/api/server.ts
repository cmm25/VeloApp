import express from "express";
import cors from "cors";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import pinataRouter from "./routes/pinata.js";
import receiptsRouter from "./routes/receipts.js";

const log = makeLogger("api");

export function createServer() {
  const app = express();

  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/pinata", pinataRouter);
  app.use("/api/receipts", receiptsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

export function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = createServer();
    app.listen(config.api.port, () => {
      log.info(`API server listening on port ${config.api.port}`);
      log.info(`  GET  /api/healthz`);
      log.info(`  GET  /api/auth/nonce`);
      log.info(`  POST /api/auth/verify`);
      log.info(`  POST /api/pinata/sign-upload`);
      log.info(`  GET  /api/receipts/:jobId`);
      resolve();
    });
  });
}
