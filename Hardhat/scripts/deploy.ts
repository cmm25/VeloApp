import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    somniaAgentRelay?: string;
  };
  minJobFee?: string;
  minBountyFee?: string;
}

function safeLower(v: unknown): string {
  return (v?.toString?.() ?? "").toLowerCase();
}

async function main() {
  const { ethers, networkName: net } = await network.connect();

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

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) {
    throw new Error(
      "No deployer account. Set DEPLOYER_PRIVATE_KEY in Hardhat/.env (64 hex chars, with or without 0x).",
    );
  }
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
        safeLower(await ext.reputation()) !== safeLower(repAddr) ||
        safeLower(await ext.athleteSbt()) !== safeLower(sbtAddr)
      ) {
        console.log("BountyExtension mismatch → redeploy");
        bountyAddr = undefined;
      }
    } catch { bountyAddr = undefined; }
  }

  if (!bountyAddr) {
    const Bounty = await ethers.getContractFactory("BountyExtension");
    const bounty = await Bounty.deploy(registryAddr, repAddr, minBountyFee, sbtAddr);
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
  const APPENDER_ROLE = await sbt.APPENDER_ROLE();
  if (!(await sbt.hasRole(APPENDER_ROLE, bountyAddr))) {
    await (await sbt.grantRole(APPENDER_ROLE, bountyAddr)).wait();
    console.log("  ✓ BountyExtension can append to AthleteSBT");
  }

  const currentCR = await sbt.coachRegistry();
  if (safeLower(currentCR) !== safeLower(coachAddr)) {
    await (await sbt.setCoachRegistry(coachAddr)).wait();
    console.log("  ✓ CoachRegistry linked to AthleteSBT");
  }

  /* 7. VeloAgentRelay (Somnia native AI result relay) */
  // The relay forwards native agent requests to the Somnia platform with itself
  // as the callback target, captures the consensus result, and re-emits it so
  // the off-chain runner can read a genuine on-chain inference result.
  const SOMNIA_AGENTS_PLATFORM =
    process.env.SOMNIA_AGENTS_CONTRACT ?? "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";

  // Derive operator (agent EOA) addresses from the same keys the runner uses,
  // so both the Form and Prescriber agents can spend through the relay.
  function deriveAddr(pk?: string): string | undefined {
    const k = pk && pk.length > 0 ? (pk.startsWith("0x") ? pk : `0x${pk}`) : undefined;
    if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) return undefined;
    try {
      return new ethers.Wallet(k).address;
    } catch {
      return undefined;
    }
  }
  const operatorAddrs = [
    deriveAddr(process.env.AGENT_FORM_PRIVATE_KEY),
    deriveAddr(process.env.AGENT_PRESCRIBER_PRIVATE_KEY),
    // External analysis model agent — only present once its dedicated key is set.
    // Granting it OPERATOR_ROLE lets it reason through the SAME native Qwen relay
    // as Form/Prescriber (with automatic Groq fallback) instead of being forced
    // straight to fallback.
    deriveAddr(process.env.AGENT_EXTERNAL_PRIVATE_KEY),
  ].filter((a): a is string => Boolean(a));

  let relayAddr = contracts.somniaAgentRelay && (await hasBytecode(contracts.somniaAgentRelay))
    ? contracts.somniaAgentRelay : undefined;

  if (relayAddr) {
    try {
      const ex = await ethers.getContractAt("VeloAgentRelay", relayAddr);
      if (safeLower(await ex.platform()) !== safeLower(SOMNIA_AGENTS_PLATFORM)) {
        console.log("VeloAgentRelay points to wrong platform → redeploy");
        relayAddr = undefined;
      }
    } catch { relayAddr = undefined; }
  }

  if (!relayAddr) {
    const Relay = await ethers.getContractFactory("VeloAgentRelay");
    const relay = await Relay.deploy(SOMNIA_AGENTS_PLATFORM, deployer.address, operatorAddrs);
    await relay.waitForDeployment();
    relayAddr = await relay.getAddress();
    console.log(`VeloAgentRelay → ${relayAddr}`);
    console.log(`  platform:  ${SOMNIA_AGENTS_PLATFORM}`);
    console.log(
      `  operators: ${operatorAddrs.join(", ") || "(none — set AGENT_*_PRIVATE_KEY, then grant OPERATOR_ROLE later)"}`,
    );
  } else {
    console.log(`VeloAgentRelay → ${relayAddr} (reused)`);
  }
  contracts.somniaAgentRelay = relayAddr;

  // Ensure both agent EOAs hold OPERATOR_ROLE (idempotent — covers reuse or
  // key changes). Requires the deployer to hold DEFAULT_ADMIN_ROLE (it does).
  if (operatorAddrs.length > 0) {
    const relayC = await ethers.getContractAt("VeloAgentRelay", relayAddr);
    const OPERATOR_ROLE = await relayC.OPERATOR_ROLE();
    for (const op of operatorAddrs) {
      if (!(await relayC.hasRole(OPERATOR_ROLE, op))) {
        await (await relayC.grantRole(OPERATOR_ROLE, op)).wait();
        console.log(`  ✓ granted OPERATOR_ROLE to ${op}`);
      }
    }
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

  console.log("\nRunner env (add to lib/velo-agents/.env):");
  console.log(`  SOMNIA_AGENT_RELAY_ADDRESS=${contracts.somniaAgentRelay ?? ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });