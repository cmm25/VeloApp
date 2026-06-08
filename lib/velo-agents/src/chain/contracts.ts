import { ethers } from "ethers";
import { ORCHESTRATOR_ABI, AGENT_REGISTRY_ABI, BOUNTY_EXTENSION_ABI, type ReceiptStruct } from "./abi.js";
import { config, externalModelConfigured } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";
import { skillHash } from "./job-spec.js";
import { signerHasOperatorRole } from "../ai/somnia-agents.js";

const log = makeLogger("contracts");

let _provider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(config.somnia.rpcUrl, {
      chainId: config.somnia.chainId,
      name: "somniaTestnet",
    });
    log.info(`Provider connected to ${config.somnia.rpcUrl}`);
  }
  return _provider;
}

export function getOrchestrator(signerOrProvider?: ethers.Signer | ethers.Provider) {
  const addr = config.contracts.orchestrator;
  if (!addr) throw new Error("ORCHESTRATOR_ADDRESS not set");
  return new ethers.Contract(
    addr,
    ORCHESTRATOR_ABI,
    signerOrProvider ?? getProvider()
  );
}

export function getAgentRegistry(signerOrProvider?: ethers.Signer | ethers.Provider) {
  const addr = config.contracts.agentRegistry;
  if (!addr) throw new Error("AGENT_REGISTRY_ADDRESS not set");
  return new ethers.Contract(
    addr,
    AGENT_REGISTRY_ABI,
    signerOrProvider ?? getProvider()
  );
}

export function getFormAgentWallet(): ethers.Wallet {
  if (!config.agents.formPrivateKey) throw new Error("AGENT_FORM_PRIVATE_KEY not set");
  return new ethers.Wallet(config.agents.formPrivateKey, getProvider());
}

export function getPrescriberWallet(): ethers.Wallet {
  if (!config.agents.prescriberPrivateKey) throw new Error("AGENT_PRESCRIBER_PRIVATE_KEY not set");
  return new ethers.Wallet(config.agents.prescriberPrivateKey, getProvider());
}

export function getExternalAgentWallet(): ethers.Wallet {
  if (!config.externalModel.privateKey) throw new Error("AGENT_EXTERNAL_PRIVATE_KEY not set");
  return new ethers.Wallet(config.externalModel.privateKey, getProvider());
}

export async function fetchNonce(agentAddress: string): Promise<bigint> {
  const orch = getOrchestrator();
  const nonce = await orch.nonceOf(agentAddress);
  return BigInt(nonce);
}

export async function fetchFormReceipt(jobId: string): Promise<ReceiptStruct> {
  const orch = getOrchestrator();
  const r = await orch.getFormReceipt(jobId);
  return {
    jobId: r.jobId,
    agent: r.agent,
    ipfsCid: r.ipfsCid,
    summaryHash: r.summaryHash,
    summary: r.summary,
    nonce: BigInt(r.nonce),
    deadline: BigInt(r.deadline),
    priorReceiptHash: r.priorReceiptHash,
  };
}

export async function fetchJob(jobId: string) {
  const orch = getOrchestrator();
  const j = await orch.getJob(jobId);
  return {
    coach: j.coach as string,
    athlete: j.athlete as string,
    videoCid: j.videoCid as string,
    fee: BigInt(j.fee),
    createdAt: BigInt(j.createdAt),
    deadline: BigInt(j.deadline),
    status: Number(j.status),
  };
}

export async function submitFormReceiptTx(
  receipt: ReceiptStruct,
  signature: string,
  signer: ethers.Wallet
): Promise<ethers.TransactionReceipt> {
  const orch = getOrchestrator(signer);
  log.info("Submitting form receipt on-chain…", { jobId: receipt.jobId });
  const tx = await orch.submitFormReceipt(receipt, signature);
  const rc = await tx.wait();
  log.info("Form receipt confirmed", { txHash: rc.hash, block: rc.blockNumber });
  return rc;
}

export async function submitPrescriptionTx(
  receipt: ReceiptStruct,
  signature: string,
  signer: ethers.Wallet
): Promise<ethers.TransactionReceipt> {
  const orch = getOrchestrator(signer);
  log.info("Submitting prescription on-chain…", { jobId: receipt.jobId });
  const tx = await orch.submitPrescription(receipt, signature);
  const rc = await tx.wait();
  log.info("Prescription confirmed", { txHash: rc.hash, block: rc.blockNumber });
  return rc;
}

export async function getChainDomainSeparator(): Promise<string> {
  const orch = getOrchestrator();
  return await orch.domainSeparator();
}

export function getBountyExtension(signerOrProvider?: ethers.Signer | ethers.Provider) {
  const addr = config.contracts.bountyExtension;
  if (!addr) throw new Error("BOUNTY_EXTENSION_ADDRESS not set");
  return new ethers.Contract(
    addr,
    BOUNTY_EXTENSION_ABI,
    signerOrProvider ?? getProvider()
  );
}

export async function fetchBounty(bountyId: bigint) {
  const ext = getBountyExtension();
  const b = await ext.getBounty(bountyId);
  return {
    poster: b.poster as string,
    athlete: b.athlete as string,
    videoCid: b.videoCid as string,
    deadline: BigInt(b.deadline),
    createdAt: BigInt(b.createdAt),
    escrow: BigInt(b.escrow),
    leadAgent: b.leadAgent as string,
    acceptedFee: BigInt(b.acceptedFee),
    status: Number(b.status),
  };
}

export async function fetchBountyNonce(agentAddress: string): Promise<bigint> {
  const ext = getBountyExtension();
  const nonce = await ext.nonceOf(agentAddress);
  return BigInt(nonce);
}

export async function settleWithSplitsTx(
  bountyId: bigint,
  receipt: ReceiptStruct,
  signature: string,
  signer: ethers.Wallet
): Promise<ethers.TransactionReceipt> {
  const ext = getBountyExtension(signer);
  log.info("Calling settleWithSplits on-chain…", { bountyId: bountyId.toString() });
  const tx = await ext.settleWithSplits(
    bountyId,
    receipt,
    signature,
    [],
    [],
    []
  );
  const rc = await tx.wait();
  log.info("settleWithSplits confirmed", { txHash: rc.hash, block: rc.blockNumber });
  return rc;
}

// Agent self-registration
//
// Skills (keccak256 of string) that each agent advertises on-chain.
// These match what the AgentRegistry test queries via agentsBySkill().
//
//   Form Agent     → "vision.pose"    (MediaPipe pose analysis)
//   Prescriber     → "coaching.tactics" (drill/prescription generation)
//
// Both agents also carry "velo.v1" so they can be found as a pair.

const skill = (s: string): string => skillHash(s);

// Form agent's PRIMARY vision skill — used both for registration and for
// self-filtering direct jobs (a job whose decoded skill equals this, or has no
// skill at all, is handled by the Form agent).
const FORM_PRIMARY_SKILL = skill("vision.pose");

const FORM_SKILLS       = [FORM_PRIMARY_SKILL,          skill("velo.v1")];
const PRESCRIBER_SKILLS = [skill("coaching.tactics"),  skill("velo.v1")];

/** bytes32 skill hash advertised by the external model agent (config-driven). */
export function externalModelSkillHash(): string {
  return skill(config.externalModel.skill);
}

/**
 * Direct-job routing for the Form agent: it handles a job when no model was
 * selected (legacy/default) or when the coach explicitly picked the pose model.
 */
export function formHandlesSkill(jobSkill: string | null): boolean {
  if (jobSkill === null) return true;
  return jobSkill.toLowerCase() === FORM_PRIMARY_SKILL.toLowerCase();
}

export async function registerAgentsOnChain(apiBase: string): Promise<void> {
  if (!config.contracts.agentRegistry) {
    log.warn("AGENT_REGISTRY_ADDRESS not set — skipping on-chain registration");
    return;
  }

  const formWallet       = getFormAgentWallet();
  const prescriberWallet = getPrescriberWallet();
  const reg              = getAgentRegistry();

  await _ensureRegistered({
    wallet:    formWallet,
    reg,
    name:      "Velo Form Analyst",
    endpoint:  `${apiBase}/api/healthz`,
    skills:    FORM_SKILLS,
    feeWei:    0n,
    agentType: "Form",
  });

  await _ensureRegistered({
    wallet:    prescriberWallet,
    reg,
    name:      "Velo Prescriber",
    endpoint:  `${apiBase}/api/healthz`,
    skills:    PRESCRIBER_SKILLS,
    feeWei:    0n,
    agentType: "Prescriber",
  });

  // External model (serve) agent — only registered once its URL + dedicated key
  // are set. Until then it advertises nothing on-chain, so the coach's picker
  // only shows the Form (pose) model and existing behaviour is unchanged. Its
  // on-chain endpoint points at the YOLO engine itself (the Koyeb host), not the
  // Render runner API, so the directory's health link resolves to the engine.
  if (externalModelConfigured()) {
    await _ensureRegistered({
      wallet:    getExternalAgentWallet(),
      reg,
      name:      config.externalModel.name,
      endpoint:  externalModelHealthUrl(),
      skills:    [externalModelSkillHash(), skill("velo.v1")],
      feeWei:    0n,
      agentType: "ExternalModel",
    });
  }
}

/**
 * Health URL of the external model's own engine host (Koyeb).
 * EXTERNAL_MODEL_URL is a full inference endpoint (e.g. .../analyze-external),
 * so derive the host origin and point /healthz at it — never append to the path.
 */
export function externalModelHealthUrl(): string {
  return `${new URL(config.externalModel.url).origin}/healthz`;
}

/**
 * Startup self-check: log, per configured agent EOA, whether it holds
 * OPERATOR_ROLE on the relay. A missing grant means that agent silently uses
 * Groq instead of the native path, so surfacing it at boot makes the gap obvious.
 */
export async function logAgentOperatorRoles(): Promise<void> {
  if (!config.somniaAgents.relayAddress) {
    log.info("OPERATOR_ROLE self-check skipped — SOMNIA_AGENT_RELAY_ADDRESS not set");
    return;
  }

  const entries: { type: string; wallet: ethers.Wallet }[] = [];
  if (config.agents.formPrivateKey) entries.push({ type: "Form", wallet: getFormAgentWallet() });
  if (config.agents.prescriberPrivateKey) {
    entries.push({ type: "Prescriber", wallet: getPrescriberWallet() });
  }
  if (externalModelConfigured()) {
    entries.push({ type: "ExternalModel", wallet: getExternalAgentWallet() });
  }

  for (const { type, wallet } of entries) {
    const has = await signerHasOperatorRole(wallet);
    if (has) {
      log.info(`OPERATOR_ROLE ✓ ${type} can use the native path`, { address: wallet.address });
    } else {
      log.warn(
        `OPERATOR_ROLE ✗ ${type} not granted — will use Groq. ` +
          `Grant with: npx hardhat run scripts/grant-operator-role.ts --network somniaTestnet`,
        { address: wallet.address },
      );
    }
  }
}

async function _ensureRegistered(opts: {
  wallet:    ethers.Wallet;
  reg:       ethers.Contract;
  name:      string;
  endpoint:  string;
  skills:    string[];
  feeWei:    bigint;
  agentType: string;
}): Promise<void> {
  const { wallet, reg, name, endpoint, skills, feeWei, agentType } = opts;
  const regWithSigner = reg.connect(wallet) as ethers.Contract;

  const already = await reg.isRegistered(wallet.address);

  if (already) {
    const agent = await reg.getAgent(wallet.address);
    // Reactivate and fix a drifted endpoint independently, so one restart can do
    // both (an inactive agent whose endpoint also moved is corrected in one run).
    if (!agent.active) {
      log.info(`${agentType} Agent inactive — re-activating`, { address: wallet.address });
      await (await (regWithSigner as any).setActive(true)).wait();
    }
    if (agent.endpoint !== endpoint) {
      // Endpoint drifted (e.g. moved to the Koyeb engine) — push an update so
      // the on-chain record matches the configured endpoint.
      log.info(`${agentType} Agent endpoint changed — updating registration`, {
        address: wallet.address,
        from: agent.endpoint,
        to: endpoint,
      });
      await (await (regWithSigner as any).update(name, endpoint, skills, feeWei)).wait();
    } else if (agent.active) {
      log.info(`${agentType} Agent already registered`, { address: wallet.address });
    }
    return;
  }

  log.info(`Registering ${agentType} Agent on-chain…`, { address: wallet.address, name });
  const tx = await (regWithSigner as any).register(name, endpoint, skills, feeWei);
  const rc = await tx.wait();
  log.info(`${agentType} Agent registered`, { txHash: rc.hash, address: wallet.address });
}
