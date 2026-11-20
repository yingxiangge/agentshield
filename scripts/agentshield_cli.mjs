#!/usr/bin/env node
/**
 * AgentShield CLI (Read-only + Calldata Builder for Binance Agentic Wallet / Developer Mode)
 *
 * Security: Never touches private keys and never broadcasts transactions directly.
 * Usage:
 *   node scripts/agentshield_cli.mjs check-agent <walletAddress>
 *   node scripts/agentshield_cli.mjs query-target <registryAddress> <targetContract>
 *   node scripts/agentshield_cli.mjs encode-claim
 *   node scripts/agentshield_cli.mjs encode-audit <targetContract> <safe|risk> <riskCode 0-4> [note]
 */
import { ethers } from 'ethers';

const DEFAULT_RPC = process.env.BSC_RPC || 'https://bsc-dataseed1.binance.org';
const AGENT_ID_REGISTRY = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';

const REGISTRY_ABI = [
  'function hasAgentId(address wallet) view returns (bool)',
  'function totalBadges() view returns (uint256)',
  'function totalAudits() view returns (uint256)',
  'function totalUniqueAuditors() view returns (uint256)',
  'function badgeClaimedAt(address wallet) view returns (uint64)',
  'function getTargetSummary(address target) view returns (uint32 safeVotes, uint32 riskVotes, uint64 lastUpdatedAt)',
  'function claimSafeBadge()',
  'function submitAudit(address target, bool isRisk, uint8 riskCode, string note)',
];

const AGENT_ID_ABI = ['function balanceOf(address owner) view returns (uint256)'];

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const iface = new ethers.Interface(REGISTRY_ABI);

  if (cmd === 'check-agent') {
    const wallet = args[0];
    if (!wallet || !ethers.isAddress(wallet)) throw new Error('Invalid wallet address');
    const provider = new ethers.JsonRpcProvider(DEFAULT_RPC);
    const agentId = new ethers.Contract(AGENT_ID_REGISTRY, AGENT_ID_ABI, provider);
    const bal = await agentId.balanceOf(wallet);
    console.log(JSON.stringify({ wallet, agentIdRegistry: AGENT_ID_REGISTRY, balance: bal.toString(), hasAgentId: bal > 0n }, null, 2));
    return;
  }

  if (cmd === 'query-target') {
    const [registryAddr, targetAddr] = args;
    if (!ethers.isAddress(registryAddr) || !ethers.isAddress(targetAddr)) {
      throw new Error('Usage: query-target <registryAddress> <targetContract>');
    }
    const provider = new ethers.JsonRpcProvider(DEFAULT_RPC);
    const reg = new ethers.Contract(registryAddr, REGISTRY_ABI, provider);
    const [safeVotes, riskVotes, lastUpdatedAt] = await reg.getTargetSummary(targetAddr);
    const [totalBadges, totalAudits, totalUniqueAuditors] = await Promise.all([
      reg.totalBadges(),
      reg.totalAudits(),
      reg.totalUniqueAuditors(),
    ]);
    console.log(
      JSON.stringify(
        {
          registry: registryAddr,
          target: targetAddr,
          safeVotes: Number(safeVotes),
          riskVotes: Number(riskVotes),
          lastUpdatedAt: Number(lastUpdatedAt),
          globalStats: {
            totalBadges: Number(totalBadges),
            totalAudits: Number(totalAudits),
            totalUniqueAuditors: Number(totalUniqueAuditors),
          },
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === 'encode-claim') {
    console.log(JSON.stringify({ method: 'claimSafeBadge()', calldata: iface.encodeFunctionData('claimSafeBadge', []), value: '0x0' }, null, 2));
    return;
  }

  if (cmd === 'encode-audit') {
    const [target, mode, riskCodeStr, ...noteParts] = args;
    if (!ethers.isAddress(target) || !['safe', 'risk'].includes(mode)) {
      throw new Error('Usage: encode-audit <targetContract> <safe|risk> <riskCode 0-4> [note]');
    }
    const isRisk = mode === 'risk';
    const riskCode = Number(riskCodeStr ?? (isRisk ? 1 : 0));
    const note = noteParts.join(' ');
    if (Buffer.byteLength(note, 'utf8') > 120) {
      throw new Error('Note exceeds 120 UTF-8 bytes');
    }
    const calldata = iface.encodeFunctionData('submitAudit', [target, isRisk, riskCode, note]);
    console.log(JSON.stringify({ method: 'submitAudit', target, isRisk, riskCode, note, calldata, value: '0x0' }, null, 2));
    return;
  }

  console.log(`AgentShield CLI
Commands:
  check-agent <wallet>
  query-target <registryAddr> <targetContract>
  encode-claim
  encode-audit <targetContract> <safe|risk> <riskCode 0-4> [note]`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
