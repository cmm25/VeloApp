import type { HardhatUserConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition-ethers";
import * as dotenv from "dotenv";
dotenv.config();

// ── account keys (filter out any missing/malformed) ───────────────────────────
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const COACH_KEY = process.env.COACH_PRIVATE_KEY;
const AGENT_FORM_KEY = process.env.AGENT_FORM_PRIVATE_KEY;
const AGENT_PRESCRIBER_KEY = process.env.AGENT_PRESCRIBER_PRIVATE_KEY;

const accounts: string[] = [
  DEPLOYER_KEY,
  COACH_KEY,
  AGENT_FORM_KEY,
  AGENT_PRESCRIBER_KEY,
].filter((k): k is string => typeof k === "string" && k.length === 66);

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