# AgentShield Technical Architecture

## 1. On-Chain Design (`contracts/AgentShieldRegistry.sol`)

- **Compiler**: Solidity `0.8.24`, optimizer enabled (`runs = 200`), EVM target `paris` (fully compatible with BNB Smart Chain mainnet and BscScan Single File Verification).
- **Agent ID Integration**:
  - `AGENT_ID_REGISTRY` is hardcoded as a `constant` pointing to the official Binance Wallet / SPACE ID Agent ID BEP-721 contract on BSC Mainnet: `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`.
  - Every state-changing function (`claimSafeBadge`, `submitAudit`) executes the `onlyAgentId` modifier, which calls `AGENT_ID_REGISTRY.balanceOf(msg.sender)` on-chain and reverts with `NotAgentIdHolder()` if zero.
  - Because `AGENT_ID_REGISTRY` is a compile-time `constant`, the exact 20-byte registry address is embedded directly in the deployed runtime bytecode, making the contract immediately discoverable by BNB Chain / Agent ID indexers.
- **Security Properties**:
  - **Non-custodial**: No `payable` functions, no `receive`/`fallback`, no ERC-20 `transferFrom`. The contract cannot hold or lose user funds.
  - **No admin backdoor**: No `onlyOwner` rug/pause/upgrade privileges.
  - **Anti-Sybil accounting**: `voterChoice[target][msg.sender]` guarantees each `.ai` wallet holds at most one active vote (`SAFE` or `RISK`) per target contract. Updating a vote decrements the old bucket and increments the new bucket atomically.
  - **Bounded calldata storage**: `note` is capped at `120` UTF-8 bytes and emitted only in events (`TargetAudited`), keeping gas cost minimal (`~$0.01` on BSC).

## 2. Verification & Local Testing

```bash
npm install
npm run compile   # Compiles with solc 0.8.24 and verifies runtime bytecode embeds 0x60b926...022f
npm test          # Runs full EVM positive & negative tests against the exact production bytecode
```

## 3. Remix + BscScan Deployment Checklist

1. Open [Remix IDE](https://remix.ethereum.org/) and paste `contracts/AgentShieldRegistry.sol`.
2. Compiler settings:
   - Compiler: `0.8.24+commit.e11b9ed9`
   - EVM Version: `paris`
   - Optimization: **Enabled**, Runs: `200`
3. Deploy to **BNB Smart Chain Mainnet (Chain ID 56)** (no constructor arguments).
4. Verify on BscScan using **Solidity (Single File)** with the exact same compiler settings above.
5. Update `bsc.address` with the deployed contract address and run `node scripts/agentshield_cli.mjs query-target <registry> <target>` to verify live RPC reads.
