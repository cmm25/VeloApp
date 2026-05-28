import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Registers agent wallets on AgentRegistry.
// Each agent calls register() on their own wallet — no admin needed.
// Run after deploy.ts.
//
// Usage: npx hardhat run scripts/register-agents.ts --network somniaTestnet

async function main() {
  const { ethers, networkName: net } = await network.connect();
  const file = path.resolve(__dirname, "../../deployments", `${net}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment at ${file} — run deploy.ts first`);

  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const registryAddr: string = deployment.contracts.agentRegistry;

  // Wallet order from hardhat.config: [0]=deployer [1]=coach [2]=agentForm [3]=agentPrescriber
  const signers = await ethers.getSigners();
  const agentForm       = signers[2] ?? signers[0];
  const agentPrescriber = signers[3] ?? signers[0];

  const reg = await ethers.getContractAt("AgentRegistry", registryAddr);
  console.log(`\nRegistry: ${registryAddr}`);

  const FORM_SKILL      = ethers.keccak256(ethers.toUtf8Bytes("vision.pose"));
  const PRESCRIBE_SKILL = ethers.keccak256(ethers.toUtf8Bytes("biomechanics.prescription"));
  const FEE             = ethers.parseEther("0.001");

  const agents = [
    { signer: agentForm,       name: "Velo Form Agent",       skill: FORM_SKILL },
    { signer: agentPrescriber, name: "Velo Prescriber Agent", skill: PRESCRIBE_SKILL },
  ];

  for (const { signer, name, skill } of agents) {
    console.log(`\n${name} (${signer.address})`);
    if (await reg.isActive(signer.address)) {
      console.log("  already registered — skip");
      continue;
    }
    const tx = await reg.connect(signer).register(name, "", [skill], FEE);
    await tx.wait();
    console.log("  ✓ registered");
  }

  console.log("\n✓ Done");
}

main().catch((e) => { console.error(e); process.exit(1); });