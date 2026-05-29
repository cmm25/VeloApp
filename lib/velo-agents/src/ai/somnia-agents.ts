import { ethers } from "ethers";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { getProvider } from "../chain/contracts.js";

const log = makeLogger("somnia-agents");

/**
 * Somnia native Agentic L1 client.
 *
 * Invokes Somnia's native agents through the `SomniaAgents` platform contract
 * (IAgentRequester). Two agent types are supported:
 *   - LLM Inference agent  → on-chain Qwen3 inference (deterministic, seed=0)
 *   - JSON API Request agent → fetch + JSON-path extract from a public API
 *
 * Because the Velo agent runner is an off-chain EOA (not a smart contract that
 * can receive the platform callback), we drive the request synchronously:
 *   1. `createRequest()` with a correctly sized deposit
 *      (deposit = getRequestDeposit() + pricePerAgent × subcommitteeSize)
 *   2. recover the requestId (static-call prediction + RequestCreated event)
 *   3. poll `getRequest(requestId)` until the request reaches consensus
 *      (Success / Failed / TimedOut) or our local timeout elapses
 *   4. decode the consensus result from the validator responses
 *
 * Every result carries the on-chain requestId + receipt reference so the
 * provenance is auditable and linkable on the Somnia agent explorer.
 */

// ── ABIs ───────────────────────────────────────────────────────────────────

// IAgentRequester — the SomniaAgents platform contract surface we need.
const AGENT_REQUESTER_ABI = [
  "function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes payload, uint256 subcommitteeSize, uint256 deadline) payable returns (uint256 requestId)",
  "function getRequestDeposit() view returns (uint256)",
  "function getRequest(uint256 requestId) view returns (tuple(uint256 id, address requester, address callbackAddress, bytes4 callbackSelector, address[] subcommittee, tuple(address validator, bytes result, uint8 status, uint256 receipt, uint256 timestamp, uint256 executionCost)[] responses, uint256 responseCount, uint256 failureCount, uint256 threshold, uint256 createdAt, uint256 deadline, uint8 status, uint8 consensusType, uint256 remainingBudget, uint256 perAgentBudget))",
  "event RequestCreated(uint256 indexed requestId, address indexed requester, uint256 agentId, uint256 perAgentBudget)",
] as const;

// LLM Inference agent — `inferChat` returns a free-form string (we ask for JSON).
const LLM_AGENT_ABI = [
  "function inferChat(string systemPrompt, string userPrompt) returns (string)",
] as const;

// JSON API Request agent — fetch a URL and extract a value by JSON path.
const JSON_API_AGENT_ABI = [
  "function request(string url, string jsonPath) returns (string)",
] as const;

// Mirrors IAgentRequester.ResponseStatus
enum ResponseStatus {
  None = 0,
  Pending = 1,
  Success = 2,
  Failed = 3,
  TimedOut = 4,
}

const ZERO_SELECTOR = "0x00000000";

export interface SomniaAgentReceipt {
  requestId: string;
  agentId: string;
  txHash: string;
  consensusStatus: string; // "Success" | "Failed" | "TimedOut"
  receipt: string | null; // validator receipt id (if any)
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

/** True when the native path is configured well enough to attempt. */
export function nativeAgentsConfigured(): boolean {
  return (
    config.somniaAgents.enabled &&
    !!config.somniaAgents.contract &&
    !!config.somniaAgents.llmAgentId &&
    config.somniaAgents.llmAgentId !== "0"
  );
}

function statusName(s: number): string {
  return ResponseStatus[s] ?? `Unknown(${s})`;
}

function buildReceiptUrl(requestId: string): string {
  const base = config.somniaAgents.receiptBaseUrl.replace(/\/$/, "");
  return `${base}/request/${requestId}`;
}

function getRequesterContract(signer: ethers.Wallet) {
  return new ethers.Contract(config.somniaAgents.contract, AGENT_REQUESTER_ABI, signer);
}

/**
 * Run an LLM Inference request through Somnia's native agent.
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
      "Somnia native agents not configured (set SOMNIA_AGENTS_ENABLED and SOMNIA_LLM_AGENT_ID)"
    );
  }
  const payload = new ethers.Interface([...LLM_AGENT_ABI]).encodeFunctionData(
    "inferChat",
    [systemPrompt, userPrompt]
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
  if (!config.somniaAgents.enabled || !config.somniaAgents.jsonApiAgentId) {
    throw new SomniaAgentsUnavailable("Somnia JSON API agent not configured");
  }
  const payload = new ethers.Interface([...JSON_API_AGENT_ABI]).encodeFunctionData(
    "request",
    [url, jsonPath]
  );
  return dispatchRequest(config.somniaAgents.jsonApiAgentId, payload, signer, "string");
}

// ── Core request lifecycle ──────────────────────────────────────────────────

async function dispatchRequest(
  agentId: string,
  payload: string,
  signer: ethers.Wallet,
  resultAbiType: string
): Promise<SomniaAgentResult> {
  const requester = getRequesterContract(signer);
  const subSize = BigInt(config.somniaAgents.subcommitteeSize);
  const pricePerAgent = BigInt(config.somniaAgents.pricePerAgentWei);

  // Deposit = operations reserve + per-agent reward × subcommittee size.
  let reserve: bigint;
  try {
    reserve = BigInt(await requester.getRequestDeposit());
  } catch (err) {
    throw new SomniaAgentsUnavailable(
      `getRequestDeposit() failed — platform unreachable: ${errMsg(err)}`
    );
  }
  const deposit = reserve + pricePerAgent * subSize;

  const deadline = BigInt(
    Math.floor(Date.now() / 1000) + config.somniaAgents.deadlineBufferSec
  );

  // EOA requester: no contract callback, so pass zero address/selector and poll.
  const callbackAddress = ethers.ZeroAddress;
  const callbackSelector = ZERO_SELECTOR;

  log.info("Creating Somnia agent request", {
    agentId,
    subSize: subSize.toString(),
    depositWei: deposit.toString(),
  });

  // Predict the requestId via static call (counter not yet incremented), then
  // send the real tx. We still cross-check against the RequestCreated event.
  let predictedId: bigint | null = null;
  try {
    predictedId = BigInt(
      await requester.createRequest.staticCall(
        BigInt(agentId),
        callbackAddress,
        callbackSelector,
        payload,
        subSize,
        deadline,
        { value: deposit }
      )
    );
  } catch (err) {
    // Static call can fail on some nodes for payable returns; not fatal.
    log.debug("createRequest staticCall prediction failed", { error: errMsg(err) });
  }

  let txHash: string;
  let requestId: bigint;
  try {
    const tx = await requester.createRequest(
      BigInt(agentId),
      callbackAddress,
      callbackSelector,
      payload,
      subSize,
      deadline,
      { value: deposit }
    );
    const rc = await tx.wait();
    txHash = rc.hash;

    const eventId = extractRequestIdFromLogs(requester, rc);
    requestId = eventId ?? predictedId ?? -1n;
    if (requestId < 0n) {
      throw new SomniaAgentsUnavailable("Could not determine requestId from tx");
    }
    log.info("Somnia agent request created", {
      requestId: requestId.toString(),
      txHash,
    });
  } catch (err) {
    throw new SomniaAgentsUnavailable(`createRequest failed: ${errMsg(err)}`);
  }

  // Poll getRequest() until consensus or local timeout.
  const result = await pollForConsensus(requester, requestId, resultAbiType);

  return {
    output: result.output,
    receipt: {
      requestId: requestId.toString(),
      agentId,
      txHash,
      consensusStatus: result.status,
      receipt: result.receiptId,
      receiptUrl: buildReceiptUrl(requestId.toString()),
    },
  };
}

function extractRequestIdFromLogs(
  contract: ethers.Contract,
  rc: ethers.TransactionReceipt
): bigint | null {
  for (const lg of rc.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: lg.topics as string[],
        data: lg.data,
      });
      if (parsed?.name === "RequestCreated") {
        return BigInt(parsed.args.requestId ?? parsed.args[0]);
      }
    } catch {
      // not our event — ignore
    }
  }
  return null;
}

async function pollForConsensus(
  requester: ethers.Contract,
  requestId: bigint,
  resultAbiType: string
): Promise<{ output: string; status: string; receiptId: string | null }> {
  const deadline = Date.now() + config.somniaAgents.requestTimeoutMs;

  while (Date.now() < deadline) {
    let req: any;
    try {
      req = await requester.getRequest(requestId);
    } catch (err) {
      log.debug("getRequest poll failed — retrying", { error: errMsg(err) });
      await sleep(config.somniaAgents.pollIntervalMs);
      continue;
    }

    const status = Number(req.status);
    if (status === ResponseStatus.Success) {
      const decoded = decodeConsensusResult(req, resultAbiType);
      log.info("Somnia agent consensus reached ✓", {
        requestId: requestId.toString(),
      });
      return { output: decoded.output, status: "Success", receiptId: decoded.receiptId };
    }
    if (status === ResponseStatus.Failed || status === ResponseStatus.TimedOut) {
      throw new SomniaAgentsUnavailable(
        `Somnia agent request ${requestId} ended ${statusName(status)}`
      );
    }

    await sleep(config.somniaAgents.pollIntervalMs);
  }

  throw new SomniaAgentsUnavailable(
    `Somnia agent request ${requestId} timed out after ${config.somniaAgents.requestTimeoutMs}ms`
  );
}

function decodeConsensusResult(
  req: any,
  resultAbiType: string
): { output: string; receiptId: string | null } {
  const responses = req.responses ?? [];
  for (const r of responses) {
    if (Number(r.status) === ResponseStatus.Success && r.result && r.result !== "0x") {
      try {
        const [decoded] = ethers.AbiCoder.defaultAbiCoder().decode(
          [resultAbiType],
          r.result
        );
        const receiptId = r.receipt ? BigInt(r.receipt).toString() : null;
        return { output: String(decoded), receiptId };
      } catch (err) {
        log.debug("Failed to decode a response result — trying next", {
          error: errMsg(err),
        });
      }
    }
  }
  throw new SomniaAgentsUnavailable("Consensus reached but no decodable result found");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
