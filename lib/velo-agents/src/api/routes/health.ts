import { Router } from "express";
import { getProvider } from "../../chain/contracts.js";
import { config } from "../../utils/config.js";

const router = Router();

router.get("/healthz", async (_req, res) => {
  let chainOk = false;
  let blockNumber: number | null = null;

  try {
    blockNumber = await getProvider().getBlockNumber();
    chainOk = true;
  } catch {
    chainOk = false;
  }

  const status = chainOk ? "ok" : "degraded";

  res.status(chainOk ? 200 : 503).json({
    status,
    version: "1.0.0",
    chain: {
      rpc: config.somnia.rpcUrl,
      chainId: config.somnia.chainId,
      blockNumber,
      connected: chainOk,
    },
    contracts: {
      orchestrator: config.contracts.orchestrator || null,
    },
    vision: {
      engineUrl: config.vision.engineUrl,
      mode: config.vision.mode,
    },
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
