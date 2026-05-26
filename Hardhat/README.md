# Velo — Smart Contracts

> On-chain infrastructure for **Velo**: AI-powered athlete analysis with coach-paid jobs, EIP-712 agent receipts, soulbound athlete history (SBT), agent registry, reputation scoring, and an optional bounty marketplace.

Built on **Somnia** with **Hardhat 3**, **Solidity 0.8.28**, and **ethers v6**.

---

## What Velo Does

A coach pays to submit an athlete's video. AI agents analyze the footage and deliver a prescription — all verifiable on-chain. The athlete receives a soulbound NFT containing their permanent training history. Agents earn fees, build reputation, and can bid on open bounties.

---

## Contract Overview

```text
Coach ──payJob()──► VeloOrchestrator ──► JobEscrow (native STT)
                         │
                         ├── Form Agent ──EIP-712 receipt──► FormReceiptSubmitted
                         ├── Prescriber ──EIP-712 receipt──► PrescriptionSubmitted
                         │                                      └──► AthleteSBT.appendReceipt
                         └── withdraw() — pull-payments to agents

AgentRegistry ◄── registered agents (skills, fees, endpoints)
Reputation    ◄── credited by BountyExtension on settle

Poster ──postBounty()──► BountyExtension (bids · accept · subContract · settleWithSplits)
```

| Contract | Role |
|----------|------|
| `VeloOrchestrator` | Core job lifecycle: pay → analyze → prescribe → split fees → update SBT |
| `AthleteSBT` | Non-transferable ERC-721 with on-chain JSON history per athlete |
| `AgentRegistry` | Permissionless agent self-registration with skill tags |
| `CoachRegistry` | Coach ↔ athlete linkage |
| `Reputation` | Role-gated job credit accumulator for agents |
| `BountyExtension` | Escrowed bounties with bidding, sub-contracting, and EIP-712 split settlement |

---

## Quick Start

**Requirements:** Node.js 20+ · npm

```bash
cd Hardhat
npm install
cp .env.example .env
# Fill in your keys (see Environment section below)
```

Compile:

```bash
npm run compile
```

Test (no external node required):

```bash
npx hardhat test
```

Deploy to Somnia testnet:

```bash
npm run deploy:somnia
```

---

## Running Tests

Tests run entirely against Hardhat's built-in simulated network — no `npx hardhat node` needed.

```bash
npm test
```

| Suite | File | What's tested |
|-------|------|---------------|
| Agent Registry | `AgentRegistry.test.ts` | Register, update, skills, active toggle |
| Reputation | `Reputation.test.ts` | Role-gated credits, rolling score cap |
| Bounty Extension | `BountyExtension.test.ts` | Post, bid, accept, settle, expire |
| Orchestrator + SBT | `VeloOrchestrator.test.ts` | Full job flow, EIP-712 receipts, soulbound rules |

**32 specs · 4 suites**

- `test/helpers.ts` — signers, contract factory, time travel, custom error assertions via `hre.network.provider`
- `test/hooks.ts` — `evm_snapshot` / `evm_revert` for isolated state between tests

---

## Networks

| Network | Type | Chain ID | Purpose |
|---------|------|----------|---------|
| `hardhat` | EDR simulated | 31337 | Local testing (default) |
| `localhost` | HTTP JSON-RPC | 31337 | Attach to `npx hardhat node` |
| `somniaTestnet` | HTTP | 50312 | Testnet deploy and demo |

- **RPC:** https://dream-rpc.somnia.network
- **Explorer:** https://shannon-explorer.somnia.network
- **Faucet:** https://testnet.somnia.network/

---

## Environment

Copy `.env.example` → `.env`. **Never commit `.env`.**

| Variable | Required | Purpose |
|----------|----------|---------|
| `DEPLOYER_PRIVATE_KEY` | Yes | Pays for deployment gas |
| `COACH_PRIVATE_KEY` | Demo | Coach account for `demo-job` script |
| `AGENT_FORM_PRIVATE_KEY` | Demo | Form analyst agent signer |
| `AGENT_PRESCRIBER_PRIVATE_KEY` | Demo | Prescription agent signer |
| `SOMNIA_TESTNET_RPC` | Optional | Defaults to `https://dream-rpc.somnia.network` |
| `SOMNIA_AGENT_REGISTRY` | Optional | Use an existing registry instead of deploying one |
| `MIN_JOB_FEE_STT` | Optional | Fee floor for jobs (default: `0.001`) |
| `MIN_BOUNTY_FEE_STT` | Optional | Fee floor for bounties (default: `0.001`) |
| `VIDEO_CID` | Demo | IPFS CID of the athlete video |
| `ATHLETE_ADDRESS` | Demo | Wallet address the SBT will be minted to |
| `JOB_FEE_WEI` | Optional | Override job fee in wei |

Keys must be **66 characters**: `0x` + 64 hex digits.  
For a demo, one wallet can fill all four roles.

---

## Scripts

### Deploy

Deploys the full contract suite. Idempotent — reuses addresses when bytecode matches.

```bash
npm run deploy:somnia
```

**Deploy order:** `AgentRegistry` → `AthleteSBT` → `CoachRegistry` → `VeloOrchestrator` → `Reputation` → `BountyExtension`

**Writes:** `deployments/somniaTestnet.json` (read by the web app and agent runner at boot).

### Register Agents

Whitelist agent addresses on Velo's own registry:

```bash
npm run register:somnia
```

### Demo Job

Simulate a complete coach → agent → SBT flow from the CLI:

```bash
# Set VIDEO_CID and ATHLETE_ADDRESS in .env first
npm run demo:somnia
```

---

## npm Scripts

| Script | What it does |
|--------|----------------|
| `compile` | Compile Solidity contracts |
| `test` | Run all 32 Mocha specs |
| `test:node` | Start a persistent local JSON-RPC node |
| `deploy:somnia` | Deploy to Somnia testnet |
| `register:somnia` | Register agents on-chain |
| `demo:somnia` | Run demo `payJob` end-to-end |
| `typecheck` | TypeScript check (no emit) |
| `lint` | Solhint on all contracts |

---

## Project Layout

```text
Hardhat/
├── contracts/
│   ├── VeloOrchestrator.sol
│   ├── AthleteSBT.sol
│   ├── AgentRegistry.sol
│   ├── CoachRegistry.sol
│   ├── Reputation.sol
│   ├── BountyExtension.sol
│   ├── abstract/        # JobEscrow · ReceiptStore · SoulboundERC721
│   ├── interfaces/
│   ├── libraries/       # ReceiptLib · JobIdLib
│   └── mocks/           # MockAgentRegistry (tests only)
├── scripts/
│   ├── deploy.ts
│   ├── register-agents.ts
│   └── demo-job.ts
├── test/
│   ├── *.test.ts
│   ├── helpers.ts
│   └── hooks.ts
├── hardhat.config.ts
├── package.json
└── .env.example
```

---

## Tooling

| Tool | Version |
|------|---------|
| Hardhat | ^3.5 |
| Solidity | 0.8.28 — optimizer 200 runs · viaIR · cancun EVM |
| OpenZeppelin Contracts | ^5.1 — AccessControl · EIP-712 · ERC-721 |
| hardhat-ethers | ethers v6 integration |
| hardhat-mocha | TypeScript test runner |
| hardhat-ignition | Deployment management |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Tests fail on first run | Run `npm run compile` first |
| `hre.ethers` errors in tests | Expected — tests use `hre.network.provider` via the Proxy in `helpers.ts`, not `hre.ethers` directly |
| Flaky state between tests | Re-run the suite; snapshot/revert hooks handle isolation |
| Deploy fails on Somnia | Check STT balance, RPC URL, and that keys are exactly 66 chars |
| Push rejected on git | Run `git pull origin main --allow-unrelated-histories` first |

---

## Security Notes

- Never commit `.env` or any private key.
- `deploy.ts` is idempotent but **not** an upgrade path — changing immutables requires redeployment.
- Agents and posters use pull-payment (`withdraw()`) to claim balances.
- `VeloOrchestrator` supports pause / unpause via `PAUSER_ROLE`.
- `BountyExtension` does not write to `AthleteSBT` in v1 (by design).

---

## License

SPDX identifiers in each source file (typically MIT). Confirm per-file headers before redistribution.
