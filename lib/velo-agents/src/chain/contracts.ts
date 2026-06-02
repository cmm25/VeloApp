import { ethers } from "ethers";
import { ORCHESTRATOR_ABI, AGENT_REGISTRY_ABI, type ReceiptStruct } from "./abi.js";
import { config } from "../utils/config.js";
import { makeLogger } from "../utils/logger.js";

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

// Agent self-registration
//
// Skills (keccak256 of string) that each agent advertises on-chain.
// These match what the AgentRegistry test queries via agentsBySkill().
//
//   Form Agent     → "vision.pose"    (MediaPipe pose analysis)
//   Prescriber     → "coaching.tactics" (drill/prescription generation)
//
// Both agents also carry "velo.v1" so they can be found as a pair.

import { keccak256, toUtf8Bytes } from "ethers";

const skill = (s: string): string => keccak256(toUtf8Bytes(s));

const FORM_SKILLS     = [skill("vision.pose"),        skill("velo.v1")];
const PRESCRIBER_SKILLS = [skill("coaching.tactics"), skill("velo.v1")];

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
    if (!agent.active) {
      log.info(`${agentType} Agent inactive — re-activating`, { address: wallet.address });
      await (await (regWithSigner as any).setActive(true)).wait();
    } else {
      log.info(`${agentType} Agent already registered`, { address: wallet.address });
    }
    return;
  }

  log.info(`Registering ${agentType} Agent on-chain…`, { address: wallet.address, name });
  const tx = await (regWithSigner as any).register(name, endpoint, skills, feeWei);
  const rc = await tx.wait();
  log.info(`${agentType} Agent registered`, { txHash: rc.hash, address: wallet.address });
}
