# Hardhat — Smart Contracts

On-chain infrastructure for Velo on Somnia (chain ID 50312). These contracts define job lifecycle, payment escrow, receipt verification, athlete history, agent identity, reputation, and the open bounty marketplace.

---

## What this folder contains

| Area | Location | Purpose |
|------|----------|---------|
| **Contracts** | `contracts/` | All deployed Solidity — orchestrator, registries, SBT, bounties, relay |
| **Interfaces** | `contracts/interfaces/` | Public ABIs consumed by other contracts |
| **Abstract bases** | `contracts/abstract/` | Shared behaviour — escrow, receipt storage, registry checks, soulbound logic |
| **Libraries** | `contracts/libraries/` | Receipt hashing and job ID derivation |
| **Mocks** | `contracts/mocks/` | Test doubles for local runs |
| **Tests** | `test/` | Full lifecycle and edge-case coverage on Hardhat's simulated network |
| **Config** | `hardhat.config.ts` | Networks, compiler settings, account loading |

Deploy and utility scripts live under `scripts/` (invoked via npm scripts below).

---

## Contracts at a glance

```mermaid
flowchart TB
  Coach["Coach wallet"]
  Orch["VeloOrchestrator"]
  Escrow["JobEscrow — inside Orchestrator"]
  SBT["AthleteSBT"]
  AR["AgentRegistry"]
  CR["CoachRegistry"]
  Rep["Reputation"]
  Bounty["BountyExtension"]
  Relay["VeloAgentRelay"]

  Coach -->|"payJob"| Orch
  Orch --> Escrow
  Orch --> AR
  Orch --> SBT
  Orch --> Rep
  Bounty --> AR
  Bounty --> Rep
  Relay -.->|"captures Somnia LLM callbacks"| Agents["velo-agents"]
```

| Contract | Role |
|----------|------|
| **VeloOrchestrator** | Central entry point — coaches pay for jobs, agents submit receipts, escrow settles |
| **AthleteSBT** | Non-transferable token per athlete; session receipts append to a permanent history |
| **AgentRegistry** | Public directory of agent wallets, skills, fees, and endpoints |
| **CoachRegistry** | On-chain list of coach wallets for role separation |
| **Reputation** | Scorebook updated after completed jobs; writable only by trusted Velo contracts |
| **BountyExtension** | Open marketplace — post tasks, bid, accept, settle on-chain |
| **VeloAgentRelay** | Receives Somnia native LLM inference callbacks so the agent runner can read results |

---

## How a session works

1. Coach calls `payJob` — fee locks in escrow, `JobRequested` event fires.
2. Form agent submits a signed EIP-712 form receipt — `FormReceiptSubmitted` event fires.
3. Prescriber agent submits a signed prescription receipt chained to the form receipt.
4. Orchestrator verifies signatures against the AgentRegistry, releases escrow (agents withdraw via pull payment), and appends the session to the athlete's SBT.

Receipts are signed off-chain; only the submit transactions touch the chain.

---

## Networks

| Name | Chain ID | Use |
|------|----------|-----|
| `hardhat` | 31337 | Local tests — built-in simulated network |
| `localhost` | 31337 | Attach to a running `hardhat node` |
| `somniaTestnet` | 50312 | Live testnet deploys |

Somnia testnet RPC: `https://dream-rpc.somnia.network`

---

## Common commands

| Command | What it does |
|---------|--------------|
| `npm run compile` | Compile all contracts |
| `npm run test` | Run the test suite locally |
| `npm run deploy:somnia` | Deploy to Somnia testnet and write `deployments/somniaTestnet.json` |
| `npm run register:somnia` | Register Form and Prescriber agent wallets in AgentRegistry |

Copy `.env.example` to `.env` and set deployer and agent private keys before deploying. Never commit `.env`.

After deploy, run `register:somnia` so the Orchestrator accepts receipts from your agent wallets.

---

## Design choices

| Decision | Why |
|----------|-----|
| **Pull payment** | Agents call `withdraw()` — avoids reentrancy and gas estimation on the Orchestrator |
| **EIP-712 receipts** | Agents sign typed messages off-chain; only submission is an on-chain transaction |
| **Soulbound history** | Athletes own their record; coaches cannot alter or delete it |
| **Composable agents** | Form and prescription are separate receipt types with explicit chaining via `priorReceiptHash` |

---

## How this connects to the rest of Velo

```mermaid
flowchart LR
  Hardhat["Hardhat contracts"]
  Deploy["deployments/somniaTestnet.json"]
  Web["Velo web app"]
  Agents["velo-agents"]

  Hardhat -->|"deploy writes"| Deploy
  Deploy --> Web
  Deploy --> Agents
  Web -->|"payJob, reads"| Hardhat
  Agents -->|"watch events, submit receipts"| Hardhat
```
## Verifying a receipt on-chain

Every completed session produces two on-chain receipts. Each receipt card in the
app shows a **Submission tx**, **Submission block**, and **ipfsCid**. You can
verify these independently using only `curl` — no wallet or tooling required.

---

### What to grab from your receipt card

| Field | Where | Example |
|-------|-------|---------|
| **Submission tx** (form) | Form Receipt section | `0xf6c15f...d48d8` |
| **Submission tx** (prescription) | Prescription Receipt section | `0x0a49b0...c4c` |
| **ipfsCid** | Either receipt card | `bafkreib74...ksbi` |

---

### 1 — Confirm a transaction is on-chain

Replace `YOUR_TX_HASH` with the **Submission tx** from the receipt card:

```bash
curl -X POST https://api.infra.testnet.somnia.network/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["YOUR_TX_HASH"],"id":1}'
```

A confirmed receipt returns two key fields:

```json
"status": "0x1",
"to": "0x2a0b15157313e81035d1f58e54da2dacd6cfdf49"
```

`status: 0x1` = transaction succeeded. `to` is the VeloOrchestrator address —
confirming the receipt was written to the correct contract on Somnia testnet
(chain ID 50312).

**Live examples from a completed session:**

```bash
# Form receipt
curl -X POST https://api.infra.testnet.somnia.network/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["0xf6c15f386e1922b77927aa2addf9a92b938a25c02e01a1405bcf9690a7dd48d8"],"id":1}'

# Prescription receipt (also mints/updates the athlete SBT)
curl -X POST https://api.infra.testnet.somnia.network/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["0x0a49b0b6e6d594739da0223a1559ad2ba955e54988707e06de54705c6bd20c4c"],"id":1}'
```

---

### 2 —  Confirm the contracts are deployed

```bash
# VeloOrchestrator
curl -X POST https://api.infra.testnet.somnia.network/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x2A0B15157313E81035D1f58e54da2dacd6Cfdf49","latest"],"id":1}'

# AthleteSBT
curl -X POST https://api.infra.testnet.somnia.network/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0x738550ebb0E9fE77E45a123617d165e4FE52C723","latest"],"id":1}'
```

Any response other than `"result":"0x"` confirms the contract is live.

---

### Note on the block explorer

The Somnia testnet Blockscout explorer (`shannon-explorer.somnia.network`) is
currently indexing historical blocks and may not yet show recent transactions.
`eth_getTransactionReceipt` is the authoritative source — a `status: 0x1`
response is final confirmation regardless of explorer visibility.

Contracts are the source of truth for job state, payments, and receipt validity. The web app sends transactions and reads state; the agent runner reacts to events and submits signed results. Neither layer can bypass on-chain verification.
