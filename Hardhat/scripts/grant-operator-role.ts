import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Grant OPERATOR_ROLE on the EXISTING VeloAgentRelay to one wallet.
//
// One-off ops task — does NOT redeploy anything. The relay's request() is
// onlyRole(OPERATOR_ROLE), so an agent EOA without the role makes every native
// reasoning call revert (AccessControlUnauthorizedAccount). Run this once per
// agent wallet that should use the native path.
//
// Needs the relay ADMIN key (the deployer that holds DEFAULT_ADMIN_ROLE) in
// DEPLOYER_PRIVATE_KEY. The target wallet to grant is taken from:
//   1. GRANT_OPERATOR_ADDRESS (an address), or
//   2. derived from AGENT_EXTERNAL_PRIVATE_KEY (the serve agent's key).
// The relay address is taken from SOMNIA_AGENT_RELAY_ADDRESS, or the
// deployments/<network>.json file written by deploy.ts.
//
// Usage (macOS/Linux):
//   GRANT_OPERATOR_ADDRESS=0xYourWallet \
//   npx hardhat run scripts/grant-operator-role.ts --network somniaTestnet
//
// Usage (Windows PowerShell):
//   $env:GRANT_OPERATOR_ADDRESS="0xYourWallet"; `
//   npx hardhat run scripts/grant-operator-role.ts --network somniaTestnet
//
// Usage (Windows cmd.exe):
//   set GRANT_OPERATOR_ADDRESS=0xYourWallet && ^
//   npx hardhat run scripts/grant-operator-role.ts --network somniaTestnet

function resolveRelayAddress(net: string): string {
  const fromEnv = process.env.SOMNIA_AGENT_RELAY_ADDRESS?.trim();
  if (fromEnv) return fromEnv;

  const file = path.resolve(__dirname, "../../deployments", `${net}.json`);
  if (fs.existsSync(file)) {
    const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
    const addr = deployment?.contracts?.somniaAgentRelay;
    if (addr) return addr;
  }
  throw new Error(
    "Relay address not found — set SOMNIA_AGENT_RELAY_ADDRESS or run deploy.ts first",
  );
}

async function main() {
  const { ethers, networkName: net } = await network.connect();

  const relayAddr = resolveRelayAddress(net);

  // Target wallet: explicit address wins, else derive from the serve agent key.
  let target = process.env.GRANT_OPERATOR_ADDRESS?.trim();
  if (!target) {
    const pk = process.env.AGENT_EXTERNAL_PRIVATE_KEY?.trim();
    if (!pk) {
      throw new Error(
        "No target — set GRANT_OPERATOR_ADDRESS or AGENT_EXTERNAL_PRIVATE_KEY",
      );
    }
    target = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`).address;
  }
  if (!ethers.isAddress(target)) {
    throw new Error(`Invalid target address: ${target}`);
  }

  // signers[0] is the deployer (DEFAULT_ADMIN_ROLE holder) per hardhat.config.
  const [admin] = await ethers.getSigners();
  const relay = await ethers.getContractAt("VeloAgentRelay", relayAddr);
  const OPERATOR_ROLE = await relay.OPERATOR_ROLE();

  console.log(`\nRelay:   ${relayAddr}`);
  console.log(`Admin:   ${admin.address}`);
  console.log(`Target:  ${target}`);

  if (await relay.hasRole(OPERATOR_ROLE, target)) {
    console.log("\n✓ Target already holds OPERATOR_ROLE — nothing to do");
    return;
  }

  const tx = await (relay.connect(admin) as any).grantRole(OPERATOR_ROLE, target);
  const rc = await tx.wait();
  console.log(`\n✓ Granted OPERATOR_ROLE (tx ${rc?.hash})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
