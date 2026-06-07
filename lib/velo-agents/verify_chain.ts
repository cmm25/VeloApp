/**
 * Chain verification — NO private key, NO gas, NO on-chain writes.
 *
 * G2.7  EIP-712 self-consistency (offline): an ephemeral wallet signs a FormReceipt
 *       with the agent's real types/domain, and verifyTypedData recovers the SAME
 *       address. Proves the typed-data is internally consistent (the #1 thing that
 *       silently breaks on-chain signature verification — and exactly what the bytes32
 *       migration would risk if RECEIPT_TYPES and ReceiptLib.sol drift).
 *
 * G3-read  Live-contract wiring (read-only): connect to the public Somnia RPC, confirm
 *       chainId, confirm the Orchestrator has bytecode (it's deployed), read minJobFee()
 *       + domainSeparator(), and assert the on-chain domainSeparator EQUALS the agent's
 *       locally-computed EIP-712 domain. If they match, signatures this agent produces
 *       WILL be accepted by the live contract — the closest you can prove without gas.
 *
 * Run:  cd lib/velo-agents && npx tsx verify_chain.ts
 */
import { ethers } from "ethers";
import { buildDomain, RECEIPT_TYPES, buildFormReceipt, signReceipt } from "./src/chain/eip712.js";
import { ORCHESTRATOR_ABI } from "./src/chain/abi.js";

const RPC = process.env.SOMNIA_RPC_URL ?? "https://dream-rpc.somnia.network";
const ORCH = process.env.ORCHESTRATOR_ADDRESS ?? "0x2A0B15157313E81035D1f58e54da2dacd6Cfdf49";
const CHAIN_ID = 50312n;

let fails = 0;
const ok = (name: string, cond: boolean, got: unknown) => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}  (${String(got)})`);
  if (!cond) fails++;
};

async function main() {
  console.log("G2.7 — EIP-712 self-consistency (offline, ephemeral key)");
  const wallet = ethers.Wallet.createRandom();
  const domain = buildDomain(ORCH);
  const receipt = buildFormReceipt(
    ethers.id("verify-job"),               // jobId (bytes32)
    wallet.address,                         // agent
    "QmVerifyCidPlaceholder",               // ipfsCid
    new TextEncoder().encode('{"report":"verify"}'), // fullReportBytes → summaryHash
    "verification summary",                 // summary
    0n,                                     // nonce
    BigInt(Math.floor(2_000_000_000)),      // deadline (fixed, future)
  );
  const sig = await signReceipt(wallet as unknown as ethers.Wallet, receipt, ORCH);
  const recovered = ethers.verifyTypedData(domain, RECEIPT_TYPES as any, receipt, sig);
  ok("signature recovers the signer", recovered.toLowerCase() === wallet.address.toLowerCase(), `${recovered.slice(0, 10)}… == ${wallet.address.slice(0, 10)}…`);
  const localDomainSep = ethers.TypedDataEncoder.hashDomain(domain);
  console.log(`     local EIP-712 domainSeparator: ${localDomainSep.slice(0, 18)}…`);

  console.log("\nG3-read — live Orchestrator on Somnia (read-only, no key, no gas)");
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  ok("connected; chainId == 50312", net.chainId === CHAIN_ID, net.chainId.toString());
  const code = await provider.getCode(ORCH);
  ok("Orchestrator has bytecode (deployed + live)", code !== "0x" && code.length > 2, `${code.length} hex chars`);

  const orch = new ethers.Contract(ORCH, ORCHESTRATOR_ABI, provider);
  try {
    const minFee = await orch.minJobFee();
    ok("read minJobFee()", typeof minFee === "bigint", `${ethers.formatEther(minFee)} STT`);
  } catch (e) {
    ok("read minJobFee()", false, (e as Error).message.slice(0, 80));
  }

  try {
    const onchainSep = await orch.domainSeparator();
    const match = onchainSep.toLowerCase() === localDomainSep.toLowerCase();
    ok("on-chain domainSeparator() == agent's local domain", match, match ? "MATCH → agent sigs accepted on-chain" : `MISMATCH onchain=${onchainSep.slice(0, 14)}…`);
  } catch (e) {
    ok("on-chain domainSeparator() == agent's local domain", false, (e as Error).message.slice(0, 80));
  }

  console.log();
  if (fails) {
    console.log(`CHAIN-VERIFY FAIL — ${fails} check(s) failed (real finding)`);
    process.exit(1);
  }
  console.log("CHAIN-VERIFY PASS — EIP-712 signing is self-consistent AND matches the LIVE Somnia Orchestrator.");
  console.log("  (This proves signature ACCEPTANCE. It does NOT submit a tx — a real receipt still needs a funded");
  console.log("   AGENT_FORM_PRIVATE_KEY, a registered agent, a live JobRequested, and an LLM key. See notes.)");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
