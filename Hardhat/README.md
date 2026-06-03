# Velo — Smart Contracts

The on-chain infrastructure for Velo, deployed on Somnia (chain ID 50312). Six Solidity contracts handle the full lifecycle of an AI coaching session: payment, escrow, cryptographic receipt verification, athlete history, agent identity, and open bounties.

---

## How a session works

A coach calls `payJob` on the Orchestrator, locking the fee in escrow and emitting an event. The agent runner picks up that event, does its work, and submits two EIP-712 signed receipts back on-chain — one from the Form Agent, one from the Prescriber. The Orchestrator verifies the signatures, releases the escrowed fee to the agents via a pull-payment mechanism (agents call `withdraw`), and appends the session to the athlete's Soulbound Token. The whole flow is trustless: no one can fake a receipt without the registered agent's private key.

---

## Contracts

### VeloOrchestrator

The central contract that every other piece of the system talks to. A coach calls it to start a session, the agents call it to submit their signed results, and it calls the escrow to release payment and the SBT to record the outcome. It knows which agent wallets are authorised to submit receipts by checking the AgentRegistry.

### AthleteSBT

A non-transferable NFT (Soulbound Token). Every athlete gets one token that persists across all their sessions and all their coaches. Each time a session completes, a receipt reference is appended to the token. The token is the athlete's permanent, portable coaching history — it cannot be transferred or burned by anyone except the contract itself.

### AgentRegistry

A public directory of AI agent wallets. Agents register their wallet address, profile metadata (name, skills, endpoint URL, fee), and an active/inactive flag. The Orchestrator checks this registry to verify that a receipt was signed by an authorised agent before accepting it.

### CoachRegistry

A simple list of coach wallet addresses. Keeps the distinction between coach and athlete roles explicit on-chain, which matters for access control in the Orchestrator and for the bounty marketplace.

### Reputation

A scorebook updated by the Orchestrator and BountyExtension contracts after each completed job. Agents accumulate a reputation score over time based on successful completions. External contracts can read it, but only trusted Velo contracts can write to it, so scores cannot be gamed.

### BountyExtension

An open marketplace where anyone can post a task (a bounty) with a video and a reward. Agents browse open bounties, bid on them, and the poster accepts one bid. The agent then completes the work and submits a receipt; the contract verifies it and releases the reward. The full lifecycle — post, bid, accept, settle — happens on-chain.

---

## Deployment

Running `npm run deploy:somnia` deploys all six contracts in the correct dependency order, wires up the access-control roles between them automatically, and writes all the resulting addresses to `deployments/somniaTestnet.json`. The agent runner and the frontend both read that file at startup.

The deploy script is idempotent in the sense that it checks dependencies before redeploying, but changing any `immutable` constructor argument (such as fee parameters) requires a fresh deploy of that contract.

After deploying, run `npm run register:somnia` to register the two agent wallets in the AgentRegistry on-chain. The Orchestrator will not accept receipts from wallets that are not registered.

---

## Networks

| Name | Chain ID | Purpose |
|------|----------|---------|
| `hardhat` | 31337 | Local tests — built-in simulated network, no node required |
| `localhost` | 31337 | Attach to a running `npx hardhat node` instance |
| `somniaTestnet` | 50312 | Live testnet — the only network used for real deploys |

Somnia testnet endpoints:
- RPC: `https://dream-rpc.somnia.network`
- Explorer: `https://shannon-explorer.somnia.network`
- Faucet: Google Cloud Web3 Somnia Shannon faucet

---

## Testing

The test suite runs entirely against Hardhat's built-in simulated network. No external node, no real tokens, no gas fees. Tests cover the full happy path as well as edge cases like expired deadlines, wrong agent signatures, and double-submission attempts.

---

## Setup

Copy `.env.example` to `.env` and fill in `DEPLOYER_PRIVATE_KEY`, `AGENT_FORM_PRIVATE_KEY`, and `AGENT_PRESCRIBER_PRIVATE_KEY`. For a quick demo a single funded wallet can play every role. Never commit `.env`.

---

## Key design decisions

**Pull payment** — agents call `withdraw()` to collect their fee rather than having it pushed to them. This avoids reentrancy risk and gas estimating complexity on the Orchestrator side.

**EIP-712 receipts** — off-chain signing means agents never need to send an on-chain transaction to produce a receipt; they just sign a typed message. Only the final `submitFormReceipt` and `submitPrescription` calls touch the chain.

**Soulbound history** — the SBT is owned by the athlete, not the coach. A coach cannot delete or modify an athlete's history. When an athlete moves to a new coach, their full history comes with them.

**deployments/ is auto-generated** — do not edit `deployments/somniaTestnet.json` by hand. The deploy script writes it; the runner and frontend read it.

---

## License

MIT — SPDX identifiers are in each contract file.
