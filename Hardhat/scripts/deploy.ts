import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

// hre.ethers is injected by @nomicfoundation/hardhat-ethers at runtime.
// TypeScript doesn't see plugin augmentations without a cast in v3.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ethers = (hre as any).ethers;
const networkName: string = (hre as any).network?.name ?? process.env.HARDHAT_NETWORK ?? "hardhat";

interface Deployment {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  contracts: {
    agentRegistry?: string;
    athleteSBT?: string;
    coachRegistry?: string;
    veloOrchestrator?: string;
    reputation?: string;
    bountyExtension?: string;
  };
  minJobFee?: string;
  minBountyFee?: string;
}

function safeLower(v: unknown): string {
  return (v?.toString?.() ?? "").toLowerCase();
}

function parseFee(env?: string, fallback = "0.001") {
  return ethers.parseEther(env && env.length > 0 ? env : fallback);
}

async function hasBytecode(addr: string): Promise<boolean> {
  try {
    const code = await ethers.provider.getCode(addr);
    return code !== "0x" && code !== "0x0";
  } catch {
    return false;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = networkName;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`\nDeployer:  ${deployer.address}`);
  console.log(`Network:   ${net} (chainId ${chainId})`);
  console.log(`Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} STT\n`);

  const outDir = path.resolve(__dirname, "../../deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${net}.json`);

  let prev: Deployment | undefined;
  if (fs.existsSync(outFile)) {
    try {
      prev = JSON.parse(fs.readFileSync(outFile, "utf8"));
      console.log(`Found existing deployment: ${outFile}`);
    } catch { prev = undefined; }
  }

  const contracts: NonNullable<Deployment["contracts"]> = { ...(prev?.contracts ?? {}) };

  /* 1. AgentRegistry */
  let registryAddr = contracts.agentRegistry && (await hasBytecode(contracts.agentRegistry))
    ? contracts.agentRegistry : undefined;

  if (!registryAddr) {
    const override = process.env.SOMNIA_AGENT_REGISTRY;
    if (override) {
      console.log(`Using Somnia AgentRegistry: ${override}`);
      registryAddr = override;
    } else {
      const Reg = await ethers.getContractFactory("AgentRegistry");
      const reg = await Reg.deploy();
      await reg.waitForDeployment();
      registryAddr = await reg.getAddress();
      console.log(`AgentRegistry → ${registryAddr}`);
    }
  } else {
    console.log(`AgentRegistry → ${registryAddr} (reused)`);
  }
  if (!registryAddr) throw new Error("AgentRegistry deploy failed");
  contracts.agentRegistry = registryAddr;

  /* 2. AthleteSBT */
  let sbtAddr = contracts.athleteSBT && (await hasBytecode(contracts.athleteSBT))
    ? contracts.athleteSBT : undefined;

  if (!sbtAddr) {
    const SBT = await ethers.getContractFactory("AthleteSBT");
    const sbt = await SBT.deploy(deployer.address);
    await sbt.waitForDeployment();
    sbtAddr = await sbt.getAddress();
    console.log(`AthleteSBT → ${sbtAddr}`);
  } else {
    console.log(`AthleteSBT → ${sbtAddr} (reused)`);
  }
  if (!sbtAddr) throw new Error("AthleteSBT deploy failed");
  contracts.athleteSBT = sbtAddr;

  /* 3. CoachRegistry */
  let coachAddr = contracts.coachRegistry && (await hasBytecode(contracts.coachRegistry))
    ? contracts.coachRegistry : undefined;

  if (coachAddr) {
    try {
      const existing = await ethers.getContractAt("CoachRegistry", coachAddr);
      if (safeLower(await existing.athleteSBT()) !== safeLower(sbtAddr)) {
        console.log("CoachRegistry points to wrong SBT → redeploy");
        coachAddr = undefined;
      }
    } catch { coachAddr = undefined; }
  }

  if (!coachAddr) {
    const Coach = await ethers.getContractFactory("CoachRegistry");
    const coach = await Coach.deploy(sbtAddr);
    await coach.waitForDeployment();
    coachAddr = await coach.getAddress();
    console.log(`CoachRegistry → ${coachAddr}`);
  } else {
    console.log(`CoachRegistry → ${coachAddr} (reused)`);
  }
  contracts.coachRegistry = coachAddr;

  /* 4. VeloOrchestrator */
  const minFee = parseFee(process.env.MIN_JOB_FEE_STT);
  let orchAddr = contracts.veloOrchestrator && (await hasBytecode(contracts.veloOrchestrator))
    ? contracts.veloOrchestrator : undefined;

  if (orchAddr) {
    try {
      const existing = await ethers.getContractAt("VeloOrchestrator", orchAddr);
      if (safeLower(await existing.agentRegistry()) !== safeLower(registryAddr)) {
        console.log("Orchestrator points to wrong registry → redeploy");
        orchAddr = undefined;
      }
    } catch { orchAddr = undefined; }
  }

  if (!orchAddr) {
    const Orch = await ethers.getContractFactory("VeloOrchestrator");
    const orch = await Orch.deploy(deployer.address, registryAddr, sbtAddr, minFee);
    await orch.waitForDeployment();
    orchAddr = await orch.getAddress();
    console.log(`VeloOrchestrator → ${orchAddr}`);

    const sbt = await ethers.getContractAt("AthleteSBT", sbtAddr);
    const APPENDER_ROLE = await sbt.APPENDER_ROLE();
    if (!(await sbt.hasRole(APPENDER_ROLE, orchAddr))) {
      await (await sbt.grantRole(APPENDER_ROLE, orchAddr)).wait();
      console.log("  ✓ Orchestrator can append to AthleteSBT");
    }
  } else {
    console.log(`VeloOrchestrator → ${orchAddr} (reused)`);
  }
  contracts.veloOrchestrator = orchAddr;

  /* 5. Reputation */
  let repAddr = contracts.reputation && (await hasBytecode(contracts.reputation))
    ? contracts.reputation : undefined;

  if (!repAddr) {
    const Rep = await ethers.getContractFactory("Reputation");
    const rep = await Rep.deploy(deployer.address);
    await rep.waitForDeployment();
    repAddr = await rep.getAddress();
    console.log(`Reputation → ${repAddr}`);
  } else {
    console.log(`Reputation → ${repAddr} (reused)`);
  }
  contracts.reputation = repAddr;

  /* 6. BountyExtension */
  const minBountyFee = parseFee(process.env.MIN_BOUNTY_FEE_STT);
  let bountyAddr = contracts.bountyExtension && (await hasBytecode(contracts.bountyExtension))
    ? contracts.bountyExtension : undefined;

  if (bountyAddr) {
    try {
      const ext = await ethers.getContractAt("BountyExtension", bountyAddr);
      if (
        safeLower(await ext.agentRegistry()) !== safeLower(registryAddr) ||
        safeLower(await ext.reputation()) !== safeLower(repAddr)
      ) {
        console.log("BountyExtension mismatch → redeploy");
        bountyAddr = undefined;
      }
    } catch { bountyAddr = undefined; }
  }

  if (!bountyAddr) {
    const Bounty = await ethers.getContractFactory("BountyExtension");
    const bounty = await Bounty.deploy(registryAddr, repAddr, minBountyFee);
    await bounty.waitForDeployment();
    bountyAddr = await bounty.getAddress();
    console.log(`BountyExtension → ${bountyAddr}`);
  } else {
    console.log(`BountyExtension → ${bountyAddr} (reused)`);
  }
  contracts.bountyExtension = bountyAddr;

  const rep = await ethers.getContractAt("Reputation", repAddr);
  const ORCH_ROLE = await rep.ORCHESTRATOR_ROLE();
  if (!(await rep.hasRole(ORCH_ROLE, bountyAddr))) {
    await (await rep.grantRole(ORCH_ROLE, bountyAddr)).wait();
    console.log("  ✓ BountyExtension can update Reputation");
  }

  const sbt = await ethers.getContractAt("AthleteSBT", sbtAddr);
  const currentCR = await sbt.coachRegistry();
  if (safeLower(currentCR) !== safeLower(coachAddr)) {
    await (await sbt.setCoachRegistry(coachAddr)).wait();
    console.log("  ✓ CoachRegistry linked to AthleteSBT");
  }

  const out: Deployment = {
    network: net, chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts,
    minJobFee: minFee.toString(),
    minBountyFee: minBountyFee.toString(),
  };

  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\n✓ Saved → ${outFile}`);
  console.log("\nDeployed contracts:");
  for (const [k, v] of Object.entries(contracts)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });