import type { HardhatUserConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition-ethers";
import * as dotenv from "dotenv";
dotenv.config();

// ── account keys (filter out any missing/malformed) ───────────────────────────
function normalizePrivateKey(raw: string | undefined): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? key : undefined;
}

const accounts: string[] = [
  normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY),
  normalizePrivateKey(process.env.COACH_PRIVATE_KEY),
  normalizePrivateKey(process.env.AGENT_FORM_PRIVATE_KEY),
  normalizePrivateKey(process.env.AGENT_PRESCRIBER_PRIVATE_KEY),
].filter((k): k is string => Boolean(k));

const SOMNIA_TESTNET_RPC =
  process.env.SOMNIA_TESTNET_RPC ?? "https://dream-rpc.somnia.network";

const config: HardhatUserConfig = {
  plugins: [hardhatEthers, hardhatMocha, hardhatIgnition],

  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",   // ← carried from v2, important for Somnia
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts-hh",
  },

  networks: {
    // ── local ────────────────────────────────────────────────
    hardhat: {
      type: "edr-simulated",
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // ── Somnia testnet ───────────────────────────────────────
    somniaTestnet: {
      type: "http",
      url: SOMNIA_TESTNET_RPC,
      chainId: 50312,
      accounts,
      timeout: 60_000,
    },
  },

  etherscan: {
    customChains: [
      {
        network: "somniaTestnet",
        chainId: 50312,
        urls: {
          apiURL: "https://shannon-explorer.somnia.network/api",
          browserURL: "https://shannon-explorer.somnia.network",
        },
      },
    ],
  },

  mocha: {
    spec: "test/**/*.test.ts",
    timeout: 120_000,    // ← carried from v2 (was 120s, not 60s)
    parallel: false,
  },
};

export default config;