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

function optionalBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
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
    bountyExtension: optional("BOUNTY_EXTENSION_ADDRESS"),
  },

  agents: {
    formPrivateKey: optional("AGENT_FORM_PRIVATE_KEY"),
    prescriberPrivateKey: optional("AGENT_PRESCRIBER_PRIVATE_KEY"),
  },

  // Somnia native Agentic L1 (SomniaAgents / IAgentRequester platform)
  // When enabled, AI reasoning is produced by Somnia's native LLM Inference
  // agent (consensus-verified, with on-chain receipts) and falls back to Groq
  // automatically on timeout / unavailability / insufficient runners.
  somniaAgents: {
    enabled: optionalBool("SOMNIA_AGENTS_ENABLED", true),
    // SomniaAgents platform contract (IAgentRequester). Testnet default.
    //   Testnet: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776 (chainId 50312)
    //   Mainnet: 0x5E5205CF39E766118C01636bED000A54D93163E6 (chainId 5031)
    contract: optional(
      "SOMNIA_AGENTS_CONTRACT",
      "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776"
    ),
    // VeloAgentRelay address (from deployments/somniaTestnet.json after deploy).
    // REQUIRED for the native on-chain path: the platform delivers an agent's
    // result ONLY to the requester's on-chain callback, so without the relay the
    // result is unreadable and we must use Groq directly (no wasted STT).
    relayAddress: optional("SOMNIA_AGENT_RELAY_ADDRESS", ""),
    // Live agent IDs from https://agents.testnet.somnia.network/ — the LLM
    // Inference agent ID must be set for the native path to activate.
    llmAgentId: optional("SOMNIA_LLM_AGENT_ID", ""),
    // JSON API Request agent — id 13174292974160097713 in the docs oracle example.
    jsonApiAgentId: optional("SOMNIA_JSON_API_AGENT_ID", "13174292974160097713"),
    // Deposit sizing: deposit = getRequestDeposit() + pricePerAgent × subcommitteeSize.
    // subcommitteeSize MUST match the platform default (3) — the basic createRequest
    // uses that default, and the contract divides the reward pot by it.
    subcommitteeSize: optionalInt("SOMNIA_AGENTS_SUBCOMMITTEE", 3),
    // Per-agent reward. Runners skip a request whose perAgentBudget is below their
    // fixed per-type price. LLM Inference = 0.07 STT today (JSON API is 0.03 STT).
    // See docs.somnia.network/agents/invoking-agents/gas-fees#current-per-agent-prices
    pricePerAgentWei: optional("SOMNIA_AGENTS_PRICE_PER_AGENT_WEI", "70000000000000000"), // 0.07 STT
    // How long the runner polls getRequest() for consensus before falling back (ms).
    // On-chain LLM inference across a subcommittee can take well over a minute.
    requestTimeoutMs: optionalInt("SOMNIA_AGENTS_TIMEOUT_MS", 120_000),
    // Poll briskly: an EOA must read a validator response out of the live Request
    // struct before the platform deletes it on consensus, so a slow interval can
    // miss the window. 1s balances catching the result against RPC load.
    pollIntervalMs: optionalInt("SOMNIA_AGENTS_POLL_MS", 1_000),
    // Reserved for createAdvancedRequest; the basic createRequest path uses the
    // platform's default timeout, so this is currently unused.
    deadlineBufferSec: optionalInt("SOMNIA_AGENTS_DEADLINE_SEC", 300),
    // Base URL for the public consensus receipt viewer (linked from the UI).
    receiptBaseUrl: optional(
      "SOMNIA_AGENTS_RECEIPT_URL",
      "https://agents.testnet.somnia.network"
    ),
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
    // Hosts like Koyeb/Render inject $PORT; fall back to API_PORT, then 3001.
    port: optionalInt("PORT", optionalInt("API_PORT", 3001)),
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
    /** Somnia testnet WS often returns 502; polling is always on. Set true to try WS too. */
    useWebSocket: optionalBool("WATCHER_USE_WEBSOCKET", false),
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
