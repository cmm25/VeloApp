import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Idempotent deploy of the full Velo contract suite
 */

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

/* ---------------- SAFE HELPERS ---------------- */

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

/* ---------------- MAIN ---------------- */

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`\nDeployer:  ${deployer.address}`);
  console.log(`Network:   ${net} (chainId ${chainId})`);
  console.log(
    `Balance:   ${ethers.formatEther(
      await ethers.provider.getBalance(deployer.address)
    )} STT\n`
  );

  const outDir = path.resolve(__dirname, "../../../deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${net}.json`);

  let prev: Deployment | undefined;
  if (fs.existsSync(outFile)) {
    try {
      prev = JSON.parse(fs.readFileSync(outFile, "utf8"));
      console.log(`Existing deployment file: ${outFile}`);
    } catch {
      prev = undefined;
    }
  }

  const contracts: NonNullable<Deployment["contracts"]> = {
    ...(prev?.contracts ?? {}),
  };

  /* ---------------- 1. AgentRegistry ---------------- */

  let registryAddr =
    contracts.agentRegistry && (await hasBytecode(contracts.agentRegistry))
      ? contracts.agentRegistry
      : undefined;

  if (!registryAddr) {
    const overrideAddr = process.env.SOMNIA_AGENT_REGISTRY;

    if (overrideAddr) {
      console.log(`Using override AgentRegistry: ${overrideAddr}`);
      registryAddr = overrideAddr;
    } else {
      const Reg = await ethers.getContractFactory("AgentRegistry");
      const reg = await Reg.deploy();
      await reg.waitForDeployment();
      registryAddr = await reg.getAddress();
    }

    console.log(`AgentRegistry → ${registryAddr}`);
  } else {
    console.log(`AgentRegistry → ${registryAddr} (reused)`);
  }

  if (!registryAddr) throw new Error("AgentRegistry failed");

  contracts.agentRegistry = registryAddr;

  /* ---------------- 2. AthleteSBT ---------------- */

  let sbtAddr =
    contracts.athleteSBT && (await hasBytecode(contracts.athleteSBT))
      ? contracts.athleteSBT
      : undefined;

  if (!sbtAddr) {
    const SBT = await ethers.getContractFactory("AthleteSBT");
    const sbt = await SBT.deploy(deployer.address);
    await sbt.waitForDeployment();
    sbtAddr = await sbt.getAddress();
    console.log(`AthleteSBT → ${sbtAddr}`);
  } else {
    console.log(`AthleteSBT → ${sbtAddr} (reused)`);
  }

  if (!sbtAddr) throw new Error("AthleteSBT failed");
  contracts.athleteSBT = sbtAddr;

  /* ---------------- 2b. CoachRegistry ---------------- */

  let coachAddr =
    contracts.coachRegistry && (await hasBytecode(contracts.coachRegistry))
      ? contracts.coachRegistry
      : undefined;

  if (coachAddr) {
    try {
      const existing = await ethers.getContractAt("CoachRegistry", coachAddr);
      const boundSbt = await existing.athleteSBT();

      if (safeLower(boundSbt) !== safeLower(sbtAddr)) {
        console.log("CoachRegistry mismatch → redeploy");
        coachAddr = undefined;
      }
    } catch {
      coachAddr = undefined;
    }
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

  /* ---------------- 3. VeloOrchestrator ---------------- */

  const minFee = parseFee(process.env.MIN_JOB_FEE_STT);

  let orchAddr =
    contracts.veloOrchestrator &&
    (await hasBytecode(contracts.veloOrchestrator))
      ? contracts.veloOrchestrator
      : undefined;

  if (orchAddr) {
    try {
      const existing = await ethers.getContractAt(
        "VeloOrchestrator",
        orchAddr
      );

      const boundReg = await existing.agentRegistry();

      if (safeLower(boundReg) !== safeLower(registryAddr)) {
        console.log("Orchestrator registry mismatch → redeploy");
        orchAddr = undefined;
      }
    } catch {
      orchAddr = undefined;
    }
  }

  if (!orchAddr) {
    const Orch = await ethers.getContractFactory("VeloOrchestrator");
    const orch = await Orch.deploy(
      deployer.address,
      registryAddr,
      sbtAddr,
      minFee
    );
    await orch.waitForDeployment();
    orchAddr = await orch.getAddress();
    console.log(`VeloOrchestrator → ${orchAddr}`);

    const sbt = await ethers.getContractAt("AthleteSBT", sbtAddr);
    const APPENDER_ROLE = await sbt.APPENDER_ROLE();

    if (!(await sbt.hasRole(APPENDER_ROLE, orchAddr))) {
      await (await sbt.grantRole(APPENDER_ROLE, orchAddr)).wait();
      console.log("Granted APPENDER_ROLE");
    }
  } else {
    console.log(`VeloOrchestrator → ${orchAddr} (reused)`);
  }

  contracts.veloOrchestrator = orchAddr;

  /* ---------------- 4. Reputation ---------------- */

  let repAddr =
    contracts.reputation && (await hasBytecode(contracts.reputation))
      ? contracts.reputation
      : undefined;

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

  /* ---------------- 5. BountyExtension ---------------- */

  const minBountyFee = parseFee(process.env.MIN_BOUNTY_FEE_STT);

  let bountyAddr =
    contracts.bountyExtension &&
    (await hasBytecode(contracts.bountyExtension))
      ? contracts.bountyExtension
      : undefined;

  if (bountyAddr) {
    try {
      const ext = await ethers.getContractAt(
        "BountyExtension",
        bountyAddr
      );

      const boundReg = await ext.agentRegistry();
      const boundRep = await ext.reputation();

      if (
        safeLower(boundReg) !== safeLower(registryAddr) ||
        safeLower(boundRep) !== safeLower(repAddr)
      ) {
        console.log("Bounty mismatch → redeploy");
        bountyAddr = undefined;
      }
    } catch {
      bountyAddr = undefined;
    }
  }

  if (!bountyAddr) {
    const Bounty = await ethers.getContractFactory("BountyExtension");
    const bounty = await Bounty.deploy(
      registryAddr,
      repAddr,
      minBountyFee
    );
    await bounty.waitForDeployment();
    bountyAddr = await bounty.getAddress();
    console.log(`BountyExtension → ${bountyAddr}`);
  } else {
    console.log(`BountyExtension → ${bountyAddr} (reused)`);
  }

  contracts.bountyExtension = bountyAddr;

  /* ---------------- 6. Grant role ---------------- */

  const rep = await ethers.getContractAt("Reputation", repAddr);
  const ORCH_ROLE = await rep.ORCHESTRATOR_ROLE();

  if (!(await rep.hasRole(ORCH_ROLE, bountyAddr))) {
    await (await rep.grantRole(ORCH_ROLE, bountyAddr)).wait();
    console.log("Granted ORCHESTRATOR_ROLE");
  }

  /* ---------------- 7. SAVE ---------------- */

  const out: Deployment = {
    network: net,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts,
    minJobFee: minFee.toString(),
    minBountyFee: minBountyFee.toString(),
  };

  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\n✓ Wrote ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});