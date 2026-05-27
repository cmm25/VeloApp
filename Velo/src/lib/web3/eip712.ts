/**
 * Client-side receipt verifier — re-derives the EIP-712 typed-data digest
 * and recovers the signing address, so the UI can prove a receipt was
 * actually signed by the agent it claims to come from.
 *
 * Domain & types mirror `lib/contracts/contracts/libraries/ReceiptLib.sol`.
 */
import {
  hashTypedData,
  recoverAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

export type ReceiptStruct = {
  jobId: Hex;
  agent: Address;
  ipfsCid: string;
  summaryHash: Hex;
  summary: string;
  nonce: bigint;
  deadline: bigint;
  priorReceiptHash: Hex;
};

export const RECEIPT_TYPES = {
  Receipt: [
    { name: "jobId", type: "bytes32" },
    { name: "agent", type: "address" },
    { name: "ipfsCid", type: "string" },
    { name: "summaryHash", type: "bytes32" },
    { name: "summary", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "priorReceiptHash", type: "bytes32" },
  ],
} as const;

export function domainFor(
  verifyingContract: Address,
  chainId: number,
): TypedDataDomain {
  return {
    name: "Velo",
    version: "1",
    chainId,
    verifyingContract,
  };
}

export async function verifyReceipt(
  receipt: ReceiptStruct,
  signature: Hex,
  domain: TypedDataDomain,
): Promise<{ ok: boolean; recovered: Address }> {
  const digest = hashTypedData({
    domain,
    types: RECEIPT_TYPES,
    primaryType: "Receipt",
    message: receipt,
  });
  const recovered = await recoverAddress({ hash: digest, signature });
  return {
    ok: recovered.toLowerCase() === receipt.agent.toLowerCase(),
    recovered,
  };
}
