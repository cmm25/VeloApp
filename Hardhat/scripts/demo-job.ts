import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test script — submits a job as the coach wallet and waits for both agent receipts.
// Run after deploy.ts and register-agents.ts.
//
// Usage:
//   VIDEO_CID=bafkreigh... ATHLETE_ADDRESS=0x... \
//     npx hardhat run scripts/demo-job.ts --network somniaTestnet

async function main() {
  const { ethers, networkName: net } = await network.connect();
  const file = path.resolve(__dirname, "../../deployments", `${net}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment at ${file} — run deploy.ts first`);

  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const orch = await ethers.getContractAt("VeloOrchestrator", dep.contracts.veloOrchestrator);

  // Wallet order: [0]=deployer [1]=coach [2]=agentForm [3]=agentPrescriber
  const signers = await ethers.getSigners();
  const coach = signers[1] ?? signers[0];
  console.log(`Coach: ${coach.address}`);

  const videoCid = process.env.VIDEO_CID;
  const athlete  = process.env.ATHLETE_ADDRESS;
  if (!videoCid || !athlete) throw new Error("Set VIDEO_CID and ATHLETE_ADDRESS env vars.");

  const minFee   = await orch.minJobFee();
  const fee      = process.env.JOB_FEE_WEI ? BigInt(process.env.JOB_FEE_WEI) : minFee;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

  console.log(`\nSubmitting job (fee=${ethers.formatEther(fee)} STT)…`);
  const tx = await orch.connect(coach).payJob(athlete, videoCid, deadline, { value: fee });
  console.log(`  tx: ${explorerTx(net, tx.hash)}`);

  // Pull the jobId out of the transaction receipt logs
  const rc = await tx.wait();
  const jobReq = (rc!.logs as unknown[])
    .map((l: unknown) => { try { return orch.interface.parseLog(l); } catch { return null; } })
    .find((p: { name: string } | null) => p?.name === "JobRequested");
  const jobId: string = jobReq!.args.jobId;
  console.log(`\n✓ Job opened: ${jobId}`);

  // Wait for both agent receipts to land on-chain.
  //
  // NOTE: we deliberately do NOT use `orch.on(...)` here. On Somnia, the RPC
  // returns log objects without the `removed` field, and hardhat-ethers' strict
  // log formatter throws `invalid value for value.removed`. Instead we poll
  // `getLogs` with a raw JsonRpcProvider and decode manually — the same proven
  // approach used by the agent runner's watcher (lib/velo-agents/src/chain/watcher.ts).
  console.log("\nWaiting for agent receipts…");

  const rawProvider = new ethers.JsonRpcProvider(rpcUrl(net));

  const orchAddress: string = dep.contracts.veloOrchestrator;
  const formTopic = ethers.id("FormReceiptSubmitted(bytes32,address,string,bytes32,string)");
  const presTopic = ethers.id("PrescriptionSubmitted(bytes32,address,string,bytes32,string)");

  const posInt = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const pollIntervalMs = posInt(process.env.POLL_INTERVAL_MS, 2000);
  const timeoutMs = posInt(process.env.RECEIPT_TIMEOUT_MS, 180_000);

  let fromBlock = Number(rc!.blockNumber);
  let formSeen = false;
  let presSeen = false;
  let timedOut = false;
  const deadlineAt = Date.now() + timeoutMs;

  const decode = (raw: { topics: readonly string[]; data: string }) => {
    try {
      return orch.interface.parseLog({ topics: raw.topics as string[], data: raw.data });
    } catch {
      return null;
    }
  };

  while (!(formSeen && presSeen)) {
    if (Date.now() > deadlineAt) {
      console.error(
        `\n⏱  Timed out after ${Math.round(timeoutMs / 1000)}s waiting for receipts ` +
          `(form=${formSeen}, prescription=${presSeen}).`,
      );
      console.error("    Are both agents running and pointed at this orchestrator?");
      timedOut = true;
      break;
    }

    try {
      const current = await rawProvider.getBlockNumber();
      if (current >= fromBlock) {
        const logs = await rawProvider.getLogs({
          address: orchAddress,
          topics: [[formTopic, presTopic], ethers.zeroPadValue(jobId, 32)],
          fromBlock,
          toBlock: current,
        });

        for (const raw of logs) {
          const parsed = decode(raw);
          if (!parsed) continue;
          const agent: string = parsed.args.agent;
          const cid: string = parsed.args.ipfsCid;
          if (parsed.name === "FormReceiptSubmitted" && !formSeen) {
            console.log(`✓ Form receipt   agent=${agent}  cid=${cid}`);
            formSeen = true;
          } else if (parsed.name === "PrescriptionSubmitted" && !presSeen) {
            console.log(`✓ Prescription   agent=${agent}  cid=${cid}`);
            presSeen = true;
          }
        }

        fromBlock = current + 1;
      }
    } catch (err) {
      console.warn(`  poll error (will retry): ${err instanceof Error ? err.message : String(err)}`);
    }

    if (formSeen && presSeen) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  // Release the polling provider so Node's event loop can exit cleanly.
  rawProvider.destroy();

  const job = await orch.getJob(jobId);
  const statusNames = ["None", "Requested", "FormSubmitted", "Completed", "Cancelled"];
  console.log(`\nFinal status: ${statusNames[Number(job.status)]}`);
  console.log(`Orchestrator: ${explorerAddr(net, dep.contracts.veloOrchestrator)}`);
  console.log(`AthleteSBT:   ${explorerAddr(net, dep.contracts.athleteSBT)}`);

  // Surface a timeout as an explicit failure so automation/CI doesn't treat a
  // missed receipt as success.
  if (timedOut) process.exitCode = 1;
}

function rpcUrl(net: string): string {
  if (net === "somniaTestnet") {
    return process.env.SOMNIA_TESTNET_RPC ?? "https://dream-rpc.somnia.network";
  }
  return process.env.LOCAL_RPC ?? "http://127.0.0.1:8545";
}

function explorerBase(net: string): string {
  if (net === "somniaTestnet") return "https://shannon-explorer.somnia.network";
  return "";
}
function explorerTx(net: string, h: string): string {
  const b = explorerBase(net);
  return b ? `${b}/tx/${h}` : h;
}
function explorerAddr(net: string, a: string): string {
  const b = explorerBase(net);
  return b ? `${b}/address/${a}` : a;
}

main().catch((e) => { console.error(e); process.exit(1); });