import { ethers } from "ethers";
import { type ReceiptStruct, ZERO_BYTES32 } from "./abi.js";
import { config } from "../utils/config.js";

// EIP-712 domain — must match VeloOrchestrator constructor: EIP712("Velo", "1")
export function buildDomain(verifyingContract: string): ethers.TypedDataDomain {
  return {
    name: "Velo",
    version: "1",
    chainId: config.somnia.chainId,
    verifyingContract,
  };
}

// Must exactly mirror ReceiptLib.sol RECEIPT_TYPEHASH
export const RECEIPT_TYPES = {
  Receipt: [
    { name: "jobId",            type: "bytes32"  },
    { name: "agent",            type: "address"  },
    { name: "ipfsCid",          type: "string"   },
    { name: "summaryHash",      type: "bytes32"  },
    { name: "summary",          type: "string"   },
    { name: "nonce",            type: "uint256"  },
    { name: "deadline",         type: "uint64"   },
    { name: "priorReceiptHash", type: "bytes32"  },
  ],
} as const;

export async function signReceipt(
  signer: ethers.Wallet,
  receipt: ReceiptStruct,
  orchestratorAddress: string
): Promise<string> {
  const domain = buildDomain(orchestratorAddress);
  const types = RECEIPT_TYPES as unknown as Record<string, ethers.TypedDataField[]>;
  return signer.signTypedData(domain, types, receipt);
}

/**
 * Replicates ReceiptLib.digest() from Solidity:
 *
 *   keccak256(abi.encode(
 *     r.jobId, r.agent, r.ipfsCid, r.summaryHash,
 *     keccak256(bytes(r.summary)), r.priorReceiptHash
 *   ))
 *
 * The Prescriber must call this on the on-chain form receipt to produce
 * the priorReceiptHash it includes in its own receipt.
 */
export function computeReceiptDigest(r: ReceiptStruct): string {
  const summaryHash = ethers.keccak256(ethers.toUtf8Bytes(r.summary));
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "string", "bytes32", "bytes32", "bytes32"],
    [r.jobId, r.agent, r.ipfsCid, r.summaryHash, summaryHash, r.priorReceiptHash]
  );
  return ethers.keccak256(encoded);
}

export function buildFormReceipt(
  jobId: string,
  agentAddress: string,
  ipfsCid: string,
  fullReportBytes: Uint8Array,
  summaryText: string,
  nonce: bigint,
  deadline: bigint
): ReceiptStruct {
  const summaryHash = ethers.keccak256(fullReportBytes);
  const summary = truncateSummary(summaryText);
  return {
    jobId,
    agent: agentAddress,
    ipfsCid,
    summaryHash,
    summary,
    nonce,
    deadline,
    priorReceiptHash: ZERO_BYTES32,
  };
}

export function buildPrescriptionReceipt(
  jobId: string,
  agentAddress: string,
  ipfsCid: string,
  fullReportBytes: Uint8Array,
  summaryText: string,
  nonce: bigint,
  deadline: bigint,
  priorReceiptHash: string
): ReceiptStruct {
  const summaryHash = ethers.keccak256(fullReportBytes);
  const summary = truncateSummary(summaryText);
  return {
    jobId,
    agent: agentAddress,
    ipfsCid,
    summaryHash,
    summary,
    nonce,
    deadline,
    priorReceiptHash,
  };
}

// On-chain limit: MAX_SUMMARY_BYTES = 1024 (ReceiptLib.sol)
const MAX_SUMMARY_BYTES = 1024;

function truncateSummary(text: string): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= MAX_SUMMARY_BYTES) return text;
  // Truncate at byte boundary then decode safely
  const truncated = encoded.slice(0, MAX_SUMMARY_BYTES - 3);
  return new TextDecoder().decode(truncated) + "...";
}
