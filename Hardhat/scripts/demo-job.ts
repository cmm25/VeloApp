import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Demo CLI — pays a job from the coach key on the configured network and
 * tails contract events, printing Somnia explorer links as each event lands.
 *
 * Usage:
 *   VIDEO_CID=bafkreigh... ATHLETE_ADDRESS=0x... \
 *     pnpm --filter @workspace/contracts run demo:somnia
 */
async function main() {
  const net = network.name;
  const file = path.resolve(__dirname, "../../../deployments", `${net}.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));

  const orch = await ethers.getContractAt("VeloOrchestrator", dep.contracts.veloOrchestrator);
  const signers = await ethers.getSigners();
  const coach = signers[1] ?? signers[0]; // hardhat.config orders deployer, coach, ...
  console.log(`Coach: ${coach.address}`);

  const videoCid = process.env.VIDEO_CID;
  const athlete = process.env.ATHLETE_ADDRESS;
  if (!videoCid || !athlete) throw new Error("Set VIDEO_CID and ATHLETE_ADDRESS.");

  const minFee = await orch.minJobFee();
  const fee = process.env.JOB_FEE_WEI ? BigInt(process.env.JOB_FEE_WEI) : minFee;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log(`Submitting payJob (fee=${ethers.formatEther(fee)} STT, deadline=${deadline})…`);
  const tx = await orch
    .connect(coach)
    .payJob(athlete, videoCid, deadline, { value: fee });
  console.log(`  tx: ${explorerTx(net, tx.hash)}`);
  const rc = await tx.wait();
  const jobReq = rc!.logs
    .map((l) => {
      try {
        return orch.interface.parseLog(l as any);
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === "JobRequested");
  const jobId: string = jobReq!.args.jobId;
  console.log(`\n✓ JobRequested: ${jobId}\n`);

  console.log("Tailing FormReceiptSubmitted & PrescriptionSubmitted…");
  await new Promise<void>((resolve) => {
    let formSeen = false;
    let presSeen = false;
    const check = () => {
      if (formSeen && presSeen) resolve();
    };
    orch.on(orch.filters.FormReceiptSubmitted(jobId), (id, agent, cid, hash) => {
      console.log(`✓ Form receipt from ${agent} cid=${cid}`);
      formSeen = true;
      check();
    });
    orch.on(
      orch.filters.PrescriptionSubmitted(jobId),
      (id, agent, cid, hash) => {
        console.log(`✓ Prescription from ${agent} cid=${cid}`);
        presSeen = true;
        check();
      },
    );
  });

  const job = await orch.getJob(jobId);
  const statusNames = ["None", "Requested", "FormSubmitted", "Completed", "Cancelled"];
  console.log(`\nFinal status: ${statusNames[Number(job.status)]}`);
  console.log(`Orchestrator: ${explorerAddr(net, dep.contracts.veloOrchestrator)}`);
  console.log(`AthleteSBT:   ${explorerAddr(net, dep.contracts.athleteSBT)}`);
}

function explorerBase(net: string) {
  if (net === "somniaTestnet") return "https://explorer.somnia.network";
  return "";
}
function explorerTx(net: string, h: string) {
  const b = explorerBase(net);
  return b ? `${b}/tx/${h}` : h;
}
function explorerAddr(net: string, a: string) {
  const b = explorerBase(net);
  return b ? `${b}/address/${a}` : a;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
