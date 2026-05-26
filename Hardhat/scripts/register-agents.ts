import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Registers AGENT_FORM and AGENT_PRESCRIBER addresses on the AgentRegistry
 * recorded in deployments/<network>.json. Only works against MockAgentRegistry
 * (i.e. when SOMNIA_AGENT_REGISTRY was not set at deploy time). For the
 * external Somnia AgentRegistry, use the somnia-agent-kit CLI.
 */
async function main() {
  const net = network.name;
  const file = path.resolve(__dirname, "../../../deployments", `${net}.json`);
  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const registryAddr: string = deployment.contracts.agentRegistry;

  const formAddr = process.env.AGENT_FORM_ADDRESS;
  const presAddr = process.env.AGENT_PRESCRIBER_ADDRESS;
  if (!formAddr || !presAddr) {
    throw new Error("Set AGENT_FORM_ADDRESS and AGENT_PRESCRIBER_ADDRESS in env.");
  }

  const reg = await ethers.getContractAt("MockAgentRegistry", registryAddr);
  console.log(`Registry: ${registryAddr}`);
  for (const a of [formAddr, presAddr]) {
    if (await reg.isActive(a)) {
      console.log(`  ${a} already active.`);
      continue;
    }
    const tx = await reg.register(a);
    await tx.wait();
    console.log(`  Registered ${a}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
