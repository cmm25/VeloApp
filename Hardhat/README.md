# Velo — Smart Contracts

On-chain infrastructure for Velo: coach-paid AI analysis jobs, soulbound athlete history, agent reputation, and an open bounty marketplace — deployed on **Somnia**.

Built with **Hardhat 3** · **Solidity 0.8.28** · **ethers v6**

---

## How It Works

A coach pays STT to submit an athlete's video. Two AI agents analyze the footage and sign cryptographic receipts. The athlete gets a permanent, non-transferable NFT containing their full coaching history. Agents earn fees and build reputation. Coaches can also post open bounties for agents to bid on.

```
Coach ──payJob()──► VeloOrchestrator ──escrows STT──► JobEscrow
                         │
                         ├── Form Agent     ──signs EIP-712 receipt──► AthleteSBT updated
                         ├── Prescriber     ──signs EIP-712 receipt──► fee split released
                         └── withdraw()     ──pull-payment to agents

AgentRegistry  ◄── agents self-register (name · skills · fee · endpoint)
Reputation     ◄── credited on every completed job
BountyExtension◄── open marketplace: post → bid → accept → settle
```

---

## Contracts

| Contract | What it does |
|---|---|
| `VeloOrchestrator` | Main engine: pay → analyze → prescribe → split fees → update athlete record |
| `AthleteSBT` | Athlete's permanent NFT — can't be transferred, holds full receipt history |
| `AgentRegistry` | Any agent wallet self-registers here with skills and fee |
| `CoachRegistry` | Coach identity — mutually exclusive with athlete role |
| `Reputation` | Agent score tracker — only writable by the orchestrator/bounty contract |
| `BountyExtension` | Open bounty marketplace with bidding, sub-contracting, and split payouts |

---

## Setup

**Requirements:** Node.js 20+ · npm

```bash
cd Hardhat
npm install
cp .env.example .env
# Fill in your private keys (see Environment section below)
```

---

## Compile

```bash
npm run compile
```

Expected output: `Compiled N Solidity files successfully`

---

## Test

No external node needed — tests run on Hardhat's built-in simulated network.

```bash
npm test
```

| Suite | File | Coverage |
|---|---|---|
| Agent Registry | `AgentRegistry.test.ts` | Register · update · skills · active toggle |
| Reputation | `Reputation.test.ts` | Role-gated credits · rolling score cap |
| Bounty Extension | `BountyExtension.test.ts` | Post · bid · accept · settle · expire |
| Orchestrator + SBT | `VeloOrchestrator.test.ts` | Full job flow · EIP-712 receipts · soulbound rules |

**32 specs · 4 suites** — all should pass before deploying.

---

## Environment

Copy `.env.example` → `.env`. Never commit `.env`.

```env
# Wallet private keys — 0x followed by 64 hex characters
DEPLOYER_PRIVATE_KEY=0x...
COACH_PRIVATE_KEY=0x...
AGENT_FORM_PRIVATE_KEY=0x...
AGENT_PRESCRIBER_PRIVATE_KEY=0x...

# Optional overrides
SOMNIA_TESTNET_RPC=https://dream-rpc.somnia.network
SOMNIA_AGENT_REGISTRY=
MIN_JOB_FEE_STT=0.001
MIN_BOUNTY_FEE_STT=0.001

# Only needed for demo-job script
VIDEO_CID=
ATHLETE_ADDRESS=
JOB_FEE_WEI=
```

| Variable | Required | Description |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | Yes | Pays gas for all deployments |
| `COACH_PRIVATE_KEY` | Demo only | Submits test jobs via `demo-job` script |
| `AGENT_FORM_PRIVATE_KEY` | Demo only | Signs form-analysis receipts |
| `AGENT_PRESCRIBER_PRIVATE_KEY` | Demo only | Signs prescription receipts |
| `SOMNIA_TESTNET_RPC` | No | Defaults to `https://dream-rpc.somnia.network` |
| `SOMNIA_AGENT_REGISTRY` | No | Skip deploying your own registry and use this address |
| `MIN_JOB_FEE_STT` | No | Minimum coach payment per job (default `0.001`) |
| `MIN_BOUNTY_FEE_STT` | No | Minimum escrow for bounties (default `0.001`) |
| `VIDEO_CID` | Demo only | IPFS CID of the swing video |
| `ATHLETE_ADDRESS` | Demo only | Wallet address the SBT is minted to |
| `JOB_FEE_WEI` | No | Override job fee in wei (leave blank to use minimum) |

> For a hackathon demo, one wallet can fill all four roles — use the same private key for all four.

---

## Deploy

Deploys all 6 contracts in the correct order. Idempotent — if a contract already exists on-chain with matching dependencies, it is reused.

```bash
npm run deploy:somnia
```

**Deploy order:** `AgentRegistry` → `AthleteSBT` → `CoachRegistry` → `VeloOrchestrator` → `Reputation` → `BountyExtension`

**Post-deploy wiring done automatically:**
- Orchestrator is granted `APPENDER_ROLE` on AthleteSBT
- BountyExtension is granted `ORCHESTRATOR_ROLE` on Reputation
- CoachRegistry is linked into AthleteSBT for mutual-exclusion checks

**Output:** `deployments/somniaTestnet.json` — the web app and agent runner read this file at boot.

---

## Register Agents

After deploy, register your agent wallets on the AgentRegistry:

```bash
npm run register:somnia
```

Each agent wallet calls `register()` on itself — the registry is permissionless and requires no admin.

---

## Demo Job

Simulate a full coach → agent → SBT flow end-to-end:

```bash
# Set VIDEO_CID and ATHLETE_ADDRESS in .env first
npm run demo:somnia
```

The script submits a job, tails events until both receipts land, and prints the final job status and Somnia explorer links.

---

## npm Scripts

| Script | What it runs |
|---|---|
| `compile` | Compile all Solidity contracts |
| `test` | Run all 32 Mocha specs |
| `test:node` | Start a local persistent JSON-RPC node |
| `deploy:somnia` | Deploy full suite to Somnia testnet |
| `register:somnia` | Register agent wallets on-chain |
| `demo:somnia` | Run a demo payJob end-to-end |
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
│   ├── abstract/          # JobEscrow · ReceiptStore · SoulboundERC721
│   ├── interfaces/        # IAgentRegistry · IAthleteSBT · IVeloOrchestrator
│   ├── libraries/         # ReceiptLib · JobIdLib
│   └── mocks/             # MockAgentRegistry (tests only)
├── scripts/
│   ├── deploy.ts
│   ├── register-agents.ts
│   └── demo-job.ts
├── test/
│   ├── AgentRegistry.test.ts
│   ├── Reputation.test.ts
│   ├── BountyExtension.test.ts
│   ├── VeloOrchestrator.test.ts
│   ├── helpers.ts
│   └── hooks.ts
├── deployments/           # Auto-generated — do not edit manually
├── hardhat.config.ts
├── package.json
└── .env.example
```

---

## Networks

| Network | Chain ID | Use |
|---|---|---|
| `hardhat` | 31337 | Tests (built-in, no node needed) |
| `localhost` | 31337 | Attach to `npx hardhat node` |
| `somniaTestnet` | 50312 | Testnet deploy and demo |

- **RPC:** https://dream-rpc.somnia.network  
- **Explorer:** https://shannon-explorer.somnia.network  
- **Faucet:** https://testnet.somnia.network

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Compiled 0 files` | Delete `artifacts-hh/` and `cache/` then recompile |
| Tests fail on first run | Run `npm run compile` before `npm test` |
| `hre.ethers is undefined` in tests | Expected — tests use `hre.network.provider` directly via the lazy Proxy in `helpers.ts` |
| Flaky test state | Re-run the full suite; `evm_snapshot`/`evm_revert` in `hooks.ts` handles isolation |
| Deploy fails — insufficient funds | Top up deployer wallet at https://testnet.somnia.network |
| Deploy fails — bad private key | Key must be exactly 66 chars: `0x` + 64 hex digits |
| `No deployment at ...` on register | Run `deploy.ts` first |
| Git push rejected | `git pull origin main --allow-unrelated-histories` |

---

## Security

- Never commit `.env` or expose private keys
- Changing any `immutable` constructor argument requires a full redeploy of that contract
- All payments use pull-payment — agents call `withdraw()`, nothing is pushed
- The orchestrator can be paused/unpaused by any wallet holding `PAUSER_ROLE`
- `BountyExtension` intentionally does not write to `AthleteSBT` in v1

---

## License

MIT — see SPDX identifiers in each contract file.