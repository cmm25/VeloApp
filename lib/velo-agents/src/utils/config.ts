import "dotenv/config";

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v.trim();
}

function optional(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim();
}

function optionalInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

export const config = {
  somnia: {
    rpcUrl: optional("SOMNIA_RPC_URL", "https://dream-rpc.somnia.network"),
    wsUrl: optional("SOMNIA_WS_URL", ""),
    chainId: optionalInt("SOMNIA_CHAIN_ID", 50312),
  },

  contracts: {
    orchestrator: optional("ORCHESTRATOR_ADDRESS"),
    agentRegistry: optional("AGENT_REGISTRY_ADDRESS"),
    athleteSBT: optional("ATHLETE_SBT_ADDRESS"),
  },

  agents: {
    formPrivateKey: optional("AGENT_FORM_PRIVATE_KEY"),
    prescriberPrivateKey: optional("AGENT_PRESCRIBER_PRIVATE_KEY"),
  },

  ai: {
    groqApiKey: optional("GROQ_API_KEY"),
    groqModel: optional("GROQ_MODEL", "llama-3.3-70b-versatile"),
    openaiApiKey: optional("OPENAI_API_KEY"),
    openaiModel: optional("OPENAI_MODEL", "gpt-4o-mini"),
    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    anthropicModel: optional("ANTHROPIC_MODEL", "claude-haiku-3-5"),
  },

  ipfs: {
    pinataJwt: optional("PINATA_JWT"),
    pinataGateway: optional("PINATA_GATEWAY", "https://gateway.pinata.cloud"),
  },

  vision: {
    engineUrl: optional("VISION_ENGINE_URL", "http://localhost:8000"),
    mode: optional("VISION_MODE", "live") as "live" | "mock",
  },

  api: {
    port: optionalInt("API_PORT", 3001),
    secret: optional("API_SECRET", "velo-dev-secret"),
    sessionTtl: optionalInt("SESSION_TTL", 3600),
  },

  supabase: {
    url: optional("SUPABASE_URL"),
    serviceKey: optional("SUPABASE_SERVICE_KEY"),
  },

  watcher: {
    pollIntervalMs: optionalInt("POLL_INTERVAL_MS", 2000),
    startBlock: optionalInt("START_BLOCK", 0),
  },
} as const;

export function validateRequiredForAgents(): void {
  const missing: string[] = [];

  if (!config.contracts.orchestrator) missing.push("ORCHESTRATOR_ADDRESS");
  if (!config.agents.formPrivateKey) missing.push("AGENT_FORM_PRIVATE_KEY");
  if (!config.agents.prescriberPrivateKey) missing.push("AGENT_PRESCRIBER_PRIVATE_KEY");
  if (!config.ai.groqApiKey && !config.ai.openaiApiKey && !config.ai.anthropicApiKey) {
    missing.push("GROQ_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY)");
  }

  if (missing.length > 0) {
    throw new Error(
      `Cannot start agent runner. Missing required config:\n  ${missing.join("\n  ")}`
    );
  }
}
