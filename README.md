# AgentShield — Anti-Sybil On-Chain Safety & Reputation Registry for `.ai` Agent IDs

**AgentShield** is a lightweight, zero-fee, non-custodial on-chain security registry on **BNB Smart Chain (BSC)** gated by **Binance Wallet Agent ID (`.ai`)**.

## Why Agent ID (`.ai`)?

Community contract-safety registries in Web3 usually fail due to Sybil attacks: scammers spin up hundreds of fresh wallets to upvote honeypots or downvote legitimate contracts.

**Binance Wallet Agent ID (`.ai`)** solves this natively on-chain:
- Every KYC-verified Binance user can claim **at most one non-transferable `.ai` Agent ID** (`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`).
- `AgentShieldRegistry` enforces `AGENT_ID_REGISTRY.balanceOf(msg.sender) > 0` on-chain for every write action, turning `.ai` into a real **1-KYC-Agent = 1-Vote** anti-Sybil security layer.

## Core Features

1. **Free Safe Agent Check-in Badge (`claimSafeBadge`)**:
   - Any `.ai` Agent ID wallet can claim 1 free, non-transferable on-chain badge (zero protocol fee, gas only).
2. **Anti-Sybil Contract Safety Registry (`submitAudit`)**:
   - Any `.ai` Agent ID wallet can flag a BSC contract as `RISK` (honeypot/high tax, unverified/rug, fake mint trap) or attest `SAFE` with an optional short evidence note (`<= 120 bytes`).
   - Strictly 1 active vote per `(targetContract, agentWallet)`; changing a vote atomically updates `safeVotes` / `riskVotes` without double-counting.
3. **Zero Custody & AI Agent CLI Ready**:
   - The contract holds **zero BNB / ERC20 funds** (no `payable` functions, no admin rug vector).
   - Ships with `scripts/agentshield_cli.mjs` so **Binance Agentic Wallet (Developer Mode)** and autonomous AI agents can query community risk scores before executing on-chain transactions.

## Quick Start

```bash
npm install
npm run compile
npm test
```

### CLI Examples (Read-only / Calldata Builder)

```bash
# Verify a wallet holds a Binance .ai Agent ID on BSC Mainnet
node scripts/agentshield_cli.mjs check-agent 0x9fae5Bc6F7e370b7f5f8402a8AfBECe11DBA8Dc2

# Generate calldata for claiming the free Safe Agent Badge
node scripts/agentshield_cli.mjs encode-claim

# Generate calldata for flagging a suspicious BSC contract
node scripts/agentshield_cli.mjs encode-audit 0xTargetContract risk 1 "honeypot sell revert"
```

## Contract Addresses

See [`bsc.address`](./bsc.address).
