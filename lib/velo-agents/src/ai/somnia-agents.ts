import { ethers } from "ethers";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";

const log = makeLogger("somnia-agents");

/**
 * Somnia native Agentic L1 client (relay path).
 *
 * Invokes Somnia's native agents through the `VeloAgentRelay` contract, which in
 * turn drives the `SomniaAgents` platform (IAgentRequester).
 *
 * Why a relay is required: the platform delivers an agent's consensus result
 * ONLY to the requester's on-chain `handleResponse` callback, then deletes the
 * request and discards the result (verified on-chain — the finalize tx emits
 * only `RequestFinalized(id,status)` + `SubcommitteePaid(...)`, never the result
 * bytes). An off-chain EOA has no callback, so its result is always lost and the
 * spent STT is wasted. The relay IS the callback: it captures the result and
 * re-emits it as a permanent `ResultReady` log we can read back.
 *
 * Flow (per request):
 *   1. `relay.request(agentId, payload)` payable — forwards a correctly sized
 *      deposit to `platform.createRequest` with the relay as the callback:
 *        deposit = getRequestDeposit() (operations-reserve floor)
 *                + pricePerAgent × subcommitteeSize (agent reward pot)
 *      The reward pot MUST clear the runner's per-agent price for the agent type
 *      (LLM Inference = 0.07 STT today) or runners skip the request and it
 *      times out. See docs.somnia.network/agents/invoking-agents/gas-fees.
 *   2. recover the requestId from the relay's `RelayRequestCreated` event.
 *   3. wait for the relay's `ResultReady(requestId, status, result)` event
 *      (bounded by our local timeout) — permanent and race-free, unlike polling
 *      the soon-to-be-deleted Request struct.
 *   4. decode the consensus result bytes.
 *
 * Every result carries the on-chain requestId + receipt URL so the provenance is
 * auditable and linkable on the Somnia agent explorer. Any timeout / failure /
 * unavailability throws `SomniaAgentsUnavailable` so the caller falls back to
 * the off-chain Groq path cleanly.
 */

// ABIs

// VeloAgentRelay — our on-chain relay (see Hardhat/contracts/VeloAgentRelay.sol).
const RELAY_ABI = [
  "function request(uint256 agentId, bytes payload) payable returns (uint256 requestId)",
  "function getRequestDeposit() view returns (uint256)",
  "function getResult(uint256 requestId) view returns (bool ready, uint8 status)",
  "event RelayRequestCreated(uint256 indexed requestId, uint256 indexed agentId, address indexed operator)",
  "event ResultReady(uint256 indexed requestId, uint8 status, bytes result)",
] as const;

// LLM Inference agent — `inferString(prompt, system, chainOfThought, allowedValues)`
// returns a free-form string (we ask for JSON). Verified against
// docs.somnia.network/agents/base-agents/llm-inference.
const LLM_AGENT_ABI = [
  "function inferString(string prompt, string system, bool chainOfThought, string[] allowedValues) returns (string response)",
] as const;

// JSON API Request agent — NOTE: unverified/deferred. The live agent exposes
// `fetchUint(string,string,uint8)` / `fetchString(...)`, not `request(...)`.
// This path is not used by the Form/Prescriber flow; do not rely on it until
// its ABI is verified against the agent explorer.
const JSON_API_AGENT_ABI = [
  "function request(string url, string jsonPath) returns (string)",
] as const;

// LLM Parse Website agent — `ExtractString(key, description, options, prompt,
// url, resolveUrl, numPages, confidenceThreshold)` scrapes a real URL and
// returns one extracted string. Verified against the agent explorer + docs
// (id 12875401142070969085, docs.somnia.network/agents/base-agents/llm-parse-website).
const PARSE_WEBSITE_AGENT_ABI = [
  "function ExtractString(string key, string description, string[] options, string prompt, string url, bool resolveUrl, uint8 numPages, uint8 confidenceThreshold) returns (string output)",
] as const;

// Mirrors ISomniaAgents.ResponseStatus
enum ResponseStatus {
  None = 0,
  Pending = 1,
  Success = 2,
  Failed = 3,
  TimedOut = 4,
}

// The basic createRequest (which the relay uses) takes the platform's default
// subcommittee size. The reward pot is divided by THIS value on-chain, so we
// size the reward against it (not a possibly-misconfigured env) to avoid
// underfunding -> runner skip -> timeout.
const PLATFORM_DEFAULT_SUBCOMMITTEE = 3n;

export interface SomniaAgentReceipt {
  requestId: string;
  agentId: string;
  txHash: string;
  consensusStatus: string; // "Success" | "Failed" | "TimedOut"
  receipt: string | null; // validator receipt id (not exposed via the relay event)
  receiptUrl: string;
}

export interface SomniaAgentResult {
  output: string; // raw consensus string returned by the agent
  receipt: SomniaAgentReceipt;
}

export class SomniaAgentsUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SomniaAgentsUnavailable";
  }
}

/**
 * True when the native path is configured well enough to attempt. The relay
 * address is REQUIRED: without it the platform result is unreadable, so we must
 * skip the (wasteful) native request entirely and go straight to Groq.
 */
export function nativeAgentsConfigured(): boolean {
  return (
    config.somniaAgents.enabled &&
    !!config.somniaAgents.contract &&
    !!config.somniaAgents.relayAddress &&
    !!config.somniaAgents.llmAgentId &&
    config.somniaAgents.llmAgentId !== "0"
  );
}

/**
 * Pure gating predicate for the parse-website path — kept separate from the
 * config singleton so it is deterministically testable. Mirrors the native
 * gating but keyed on the parse-website agent id.
 */
export function isParseWebsiteConfigured(c: {
  enabled: boolean;
  contract?: string;
  relayAddress?: string;
  parseWebsiteAgentId?: string;
}): boolean {
  return (
    c.enabled &&
    !!c.contract &&
    !!c.relayAddress &&
    !!c.parseWebsiteAgentId &&
    c.parseWebsiteAgentId !== "0"
  );
}

/**
 * True when the LLM Parse Website path is configured. Keyed on the parse-website
 * agent id, so the verified-technique reference stays inert until explicitly
 * enabled (opt-in exactly like SOMNIA_LLM_AGENT_ID).
 */
export function parseWebsiteConfigured(): boolean {
  return isParseWebsiteConfigured(config.somniaAgents);
}

/**
 * Encode the LLM Parse Website `ExtractString` call. Pure (no chain/network) so
 * the wiring — argument order and `resolveUrl=false` (scrape the explicit source
 * URL directly), numPages=1, confidenceThreshold=60 — is independently testable.
 */
export function encodeParseWebsitePayload(prompt: string, url: string): string {
  return new ethers.Interface([...PARSE_WEBSITE_AGENT_ABI]).encodeFunctionData(
    "ExtractString",
    ["tip", "A concise, actionable tennis coaching tip", [], prompt, url, false, 1, 60]
  );
}

function statusName(s: number): string {
  return ResponseStatus[s] ?? `Unknown(${s})`;
}

function buildReceiptUrl(requestId: string): string {
  // Receipt viewer route is /receipts/<request-id> (testnet base:
  // https://agents.testnet.somnia.network). See docs → invoking-agents/receipts.
  const base = config.somniaAgents.receiptBaseUrl.replace(/\/$/, "");
  return `${base}/receipts/${requestId}`;
}

function getRelayContract(signer: ethers.Wallet) {
  if (!config.somniaAgents.relayAddress) {
    throw new SomniaAgentsUnavailable(
      "SOMNIA_AGENT_RELAY_ADDRESS not set — the native on-chain result requires the deployed VeloAgentRelay"
    );
  }
  return new ethers.Contract(config.somniaAgents.relayAddress, [...RELAY_ABI], signer);
}

/**
 * Run an LLM Inference request through Somnia's native agent (via the relay).
 * Returns the raw consensus string plus the auditable receipt reference.
 * Throws `SomniaAgentsUnavailable` on any timeout / unavailability so the
 * caller can fall back to the off-chain path.
 */
export async function runLlmInference(
  systemPrompt: string,
  userPrompt: string,
  signer: ethers.Wallet
): Promise<SomniaAgentResult> {
  if (!nativeAgentsConfigured()) {
    throw new SomniaAgentsUnavailable(
      "Somnia native agents not configured (set SOMNIA_AGENTS_ENABLED, SOMNIA_AGENT_RELAY_ADDRESS and SOMNIA_LLM_AGENT_ID)"
    );
  }
  // inferString(prompt, system, chainOfThought, allowedValues): user prompt is
  // first, system prompt second. We disable chain-of-thought (we want a single
  // deterministic JSON answer) and leave allowedValues empty (unconstrained).
  const payload = new ethers.Interface([...LLM_AGENT_ABI]).encodeFunctionData(
    "inferString",
    [userPrompt, systemPrompt, false, []]
  );
  return dispatchRequest(config.somniaAgents.llmAgentId, payload, signer, "string");
}

/**
 * Run a JSON API Request through Somnia's native agent. Provided for
 * completeness so external data lookups can also be on-chain + auditable.
 */
export async function runJsonApiRequest(
  url: string,
  jsonPath: string,
  signer: ethers.Wallet
): Promise<SomniaAgentResult> {
  if (!config.somniaAgents.enabled || !config.somniaAgents.relayAddress || !config.somniaAgents.jsonApiAgentId) {
    throw new SomniaAgentsUnavailable(
      "Somnia JSON API agent not configured (needs SOMNIA_AGENT_RELAY_ADDRESS + SOMNIA_JSON_API_AGENT_ID)"
    );
  }
  const payload = new ethers.Interface([...JSON_API_AGENT_ABI]).encodeFunctionData(
    "request",
    [url, jsonPath]
  );
  return dispatchRequest(config.somniaAgents.jsonApiAgentId, payload, signer, "string");
}

/**
 * Run an LLM Parse Website request through Somnia's native agent (via the relay).
 * Scrapes the given real source URL and extracts a single coaching tip, returning
 * the consensus output plus its auditable receipt. Throws `SomniaAgentsUnavailable`
 * on any timeout / unavailability so callers can skip the reference cleanly.
 */
export async function runParseWebsite(
  prompt: string,
  url: string,
  signer: ethers.Wallet
): Promise<SomniaAgentResult> {
  if (!parseWebsiteConfigured()) {
    throw new SomniaAgentsUnavailable(
      "Somnia parse-website agent not configured (set SOMNIA_AGENT_RELAY_ADDRESS and SOMNIA_PARSE_WEBSITE_AGENT_ID)"
    );
  }
  const payload = encodeParseWebsitePayload(prompt, url);
  return dispatchRequest(config.somniaAgents.parseWebsiteAgentId, payload, signer, "string");
}

// Core request lifecycle

async function dispatchRequest(
  agentId: string,
  payload: string,
  signer: ethers.Wallet,
  resultAbiType: string
): Promise<SomniaAgentResult> {
  const relay = getRelayContract(signer);
  const pricePerAgent = BigInt(config.somniaAgents.pricePerAgentWei);
  // Size the reward against the platform default (what the contract actually
  // divides by), not the env value — a misconfigured env must not underfund.
  const subSize = PLATFORM_DEFAULT_SUBCOMMITTEE;
  if (BigInt(config.somniaAgents.subcommitteeSize) !== subSize) {
    log.warn(
      `SOMNIA_AGENTS_SUBCOMMITTEE=${config.somniaAgents.subcommitteeSize} ignored — ` +
        `basic createRequest uses the platform default (${subSize}); sizing reward against it.`
    );
  }

  // Deposit = operations-reserve floor + agent reward pot.
  //   reserve = getRequestDeposit()          (= minPerAgentDeposit × default subSize)
  //   reward  = pricePerAgent × subSize       (must clear the runner's per-agent
  //                                            price or runners skip the request)
  let reserve: bigint;
  try {
    reserve = BigInt(await relay.getRequestDeposit());
  } catch (err) {
    throw new SomniaAgentsUnavailable(
      `relay.getRequestDeposit() failed — relay/platform unreachable: ${errMsg(err)}`
    );
  }
  const reward = pricePerAgent * subSize;
  const deposit = reserve + reward;
  const perAgentBudget = subSize > 0n ? reward / subSize : 0n;

  log.info("Creating Somnia agent request via relay", {
    agentId,
    relay: config.somniaAgents.relayAddress,
    subSize: subSize.toString(),
    reserveWei: reserve.toString(),
    rewardWei: reward.toString(),
    depositWei: deposit.toString(),
    perAgentBudgetWei: perAgentBudget.toString(),
  });
  if (perAgentBudget === 0n) {
    log.warn(
      "perAgentBudget is 0 — runners will skip this request. Raise SOMNIA_AGENTS_PRICE_PER_AGENT_WEI."
    );
  }

  let txHash: string;
  let requestId: bigint;
  let fromBlock: number;
  try {
    const tx = await relay.request(BigInt(agentId), payload, { value: deposit });
    const rc = await tx.wait();
    txHash = rc.hash;
    fromBlock = rc.blockNumber;

    const eventId = extractRelayRequestId(relay, rc);
    if (eventId === null) {
      throw new SomniaAgentsUnavailable("Could not determine requestId from relay tx");
    }
    requestId = eventId;
    log.info("Somnia agent request created via relay", {
      requestId: requestId.toString(),
      txHash,
      block: fromBlock,
    });
  } catch (err) {
    if (err instanceof SomniaAgentsUnavailable) throw err;
    throw new SomniaAgentsUnavailable(`relay.request failed: ${errMsg(err)}`);
  }

  // Wait for the relay's ResultReady event (permanent log, race-free).
  const result = await waitForResultReady(relay, requestId, resultAbiType, fromBlock);

  return {
    output: result.output,
    receipt: {
      requestId: requestId.toString(),
      agentId,
      txHash,
      consensusStatus: result.status,
      receipt: null,
      receiptUrl: buildReceiptUrl(requestId.toString()),
    },
  };
}

function extractRelayRequestId(
  contract: ethers.Contract,
  rc: ethers.TransactionReceipt
): bigint | null {
  for (const lg of rc.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: lg.topics as string[],
        data: lg.data,
      });
      if (parsed?.name === "RelayRequestCreated") {
        return BigInt(parsed.args.requestId ?? parsed.args[0]);
      }
    } catch {
      // not our event — ignore
    }
  }
  return null;
}

/**
 * Wait for the relay to emit `ResultReady(requestId, status, result)`. The event
 * is permanent, so unlike polling the soon-deleted Request struct this cannot
 * miss the result. Bounded by the local timeout, after which we fall back.
 */
async function waitForResultReady(
  relay: ethers.Contract,
  requestId: bigint,
  resultAbiType: string,
  fromBlock: number
): Promise<{ output: string; status: string }> {
  const deadline = Date.now() + config.somniaAgents.requestTimeoutMs;
  const filter = relay.filters.ResultReady(requestId);
  const provider = relay.runner?.provider ?? null;
  let from = fromBlock;
  let lastPollError: string | null = null;

  while (Date.now() < deadline) {
    let logs: ethers.Log[] = [];
    try {
      // Scan only [from..latest] each poll (not the whole chain) to keep RPC
      // load down. Re-scan the boundary block next iteration (from = latest, not
      // latest+1) so a result landing exactly on it is never missed. The
      // ResultReady event is emitted once and is permanent, so this cannot race.
      let to: number | undefined;
      if (provider) {
        to = await provider.getBlockNumber();
        if (to < from) to = from;
      }
      logs = (await relay.queryFilter(filter, from, to)) as ethers.Log[];
      lastPollError = null;
      if (to !== undefined) from = to;
    } catch (err) {
      lastPollError = errMsg(err);
      log.debug("queryFilter ResultReady failed — retrying", { error: lastPollError });
      await sleep(config.somniaAgents.pollIntervalMs);
      continue;
    }

    if (logs.length > 0) {
      const ev = logs[logs.length - 1] as ethers.EventLog;
      const status = Number(ev.args.status);
      const resultBytes: string = ev.args.result;

      if (status !== ResponseStatus.Success) {
        throw new SomniaAgentsUnavailable(
          `Somnia agent request ${requestId} finalized with status ${statusName(status)} ` +
            `(likely no runners accepted it or validators failed) — falling back`
        );
      }
      if (!resultBytes || resultBytes === "0x") {
        throw new SomniaAgentsUnavailable(
          `Somnia agent request ${requestId} finalized Success but the relay captured an ` +
            `empty result — falling back`
        );
      }
      let output: string;
      try {
        const [decoded] = ethers.AbiCoder.defaultAbiCoder().decode([resultAbiType], resultBytes);
        output = String(decoded);
      } catch (err) {
        throw new SomniaAgentsUnavailable(
          `Somnia agent request ${requestId} result could not be decoded as ${resultAbiType}: ` +
            `${errMsg(err)} — falling back`
        );
      }
      log.info("Somnia agent consensus result captured ✓", {
        requestId: requestId.toString(),
      });
      return { output, status: "Success" };
    }

    await sleep(config.somniaAgents.pollIntervalMs);
  }

  const rpcNote = lastPollError ? ` Last RPC error: ${lastPollError}.` : "";
  throw new SomniaAgentsUnavailable(
    `Somnia agent request ${requestId} produced no ResultReady event within ` +
      `${config.somniaAgents.requestTimeoutMs}ms — raise SOMNIA_AGENTS_TIMEOUT_MS, or the ` +
      `request may have been underfunded (raise SOMNIA_AGENTS_PRICE_PER_AGENT_WEI).${rpcNote} ` +
      `Falling back`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
