# Velo — Smart Contracts

On-chain infrastructure for Velo: coach-paid AI analysis jobs, soulbound athlete
history, agent reputation, and an open bounty marketplace — deployed on
**Somnia** (chainId 50312).

Built with Hardhat 3 · Solidity 0.8.28 · ethers v6.

## How it works

A coach pays STT to submit an athlete's video. Two AI agents analyze it and sign
cryptographic receipts. The athlete gets a permanent, non-transferable NFT with
their full coaching history. Agents earn fees and build reputation, and coaches
can post open bounties for agents to bid on.

```
Coach ──payJob()──► VeloOrchestrator ──escrows STT──► JobEscrow
                         ├── Form Agent  ──EIP-712 receipt──► AthleteSBT updated
                         ├── Prescriber  ──EIP-712 receipt──► fee split released
                         └── withdraw()  ──pull-payment to agents
```

## Contracts

| Contract | What it does |
|---|---|
| `VeloOrchestrator` | Main workflow: takes payment, tracks the job, verifies receipts, releases payouts. |
| `AthleteSBT` | Non-transferable NFT storing an athlete's completed receipts. |
| `AgentRegistry` | Public directory where agents list their profile, skills, fee, endpoint. |
| `CoachRegistry` | Coach identity list (keeps coach vs athlete roles clear). |
| `Reputation` | Agent scorebook, updated only by trusted Velo contracts. |
| `BountyExtension` | Open task board: post → bid → accept → settle on-chain. |

## Setup

```bash
cd Hardhat
npm install
cp .env.example .env   # fill in your private keys
```

Set `DEPLOYER_PRIVATE_KEY` (pays deploy gas) and the agent keys. For a hackathon
demo, one wallet can fill every role. Optional overrides (`SOMNIA_TESTNET_RPC`,
`MIN_JOB_FEE_STT`, …) are documented in `.env.example`. Never commit `.env`.

## Common commands

```bash
npm run compile          # compile contracts
npm test                 # run the test suite (built-in simulated network)
npm run deploy:somnia    # deploy the full suite to Somnia testnet
npm run register:somnia  # register agent wallets on-chain
npm run demo:somnia      # run a demo payJob end-to-end
```

`deploy:somnia` deploys all six contracts in order, wires up the roles
automatically, and writes the addresses to `deployments/somniaTestnet.json` —
the file the web app and agent runner read at boot. It is idempotent: existing
contracts with matching dependencies are reused.

## Networks

| Network | Chain ID | Use |
|---|---|---|
| `hardhat` | 31337 | Tests (built-in, no node needed) |
| `localhost` | 31337 | Attach to `npx hardhat node` |
| `somniaTestnet` | 50312 | Testnet deploy and demo |

- RPC: https://dream-rpc.somnia.network
- Explorer: https://shannon-explorer.somnia.network
- Faucet: https://cloud.google.com/application/web3/faucet/somnia/shannon

## Notes

- Payments use pull-payment — agents call `withdraw()`, nothing is pushed.
- Changing an `immutable` constructor argument requires redeploying that contract.
- `deployments/` is auto-generated; do not edit it by hand.

## License

MIT — see SPDX identifiers in each contract file.
