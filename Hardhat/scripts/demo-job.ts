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

  // Wait for both agent receipts to land on-chain
  console.log("\nWaiting for agent receipts…");
  await new Promise<void>((resolve) => {
    let formSeen = false;
    let presSeen = false;
    const check = () => { if (formSeen && presSeen) resolve(); };

    orch.on(orch.filters.FormReceiptSubmitted(jobId),
      (_id: unknown, agent: string, cid: string) => {
        console.log(`✓ Form receipt   agent=${agent}  cid=${cid}`);
        formSeen = true;
        check();
      });

    orch.on(orch.filters.PrescriptionSubmitted(jobId),
      (_id: unknown, agent: string, cid: string) => {
        console.log(`✓ Prescription   agent=${agent}  cid=${cid}`);
        presSeen = true;
        check();
      });
  });

  const job = await orch.getJob(jobId);
  const statusNames = ["None", "Requested", "FormSubmitted", "Completed", "Cancelled"];
  console.log(`\nFinal status: ${statusNames[Number(job.status)]}`);
  console.log(`Orchestrator: ${explorerAddr(net, dep.contracts.veloOrchestrator)}`);
  console.log(`AthleteSBT:   ${explorerAddr(net, dep.contracts.athleteSBT)}`);
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