import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { ethers } from 'ethers';
import { createVM } from '@ethereumjs/vm';
import { Common, Mainnet, Hardfork } from '@ethereumjs/common';
import { createAddressFromString, hexToBytes, bytesToHex, Account } from '@ethereumjs/util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const AGENT_ID_ADDR = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f';
const DEPLOYER = '0x1000000000000000000000000000000000000001';
const ALICE = '0x2000000000000000000000000000000000000002';
const BOB = '0x3000000000000000000000000000000000000003';
const CHARLIE = '0x4000000000000000000000000000000000000004';
const TARGET_A = '0x9999999999999999999999999999999999999999';

function compileSolidity(name, content) {
  const input = {
    language: 'Solidity',
    sources: { [name]: { content } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  return out.contracts[name];
}

const MOCK_AGENT_ID_SOL = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockAgentID {
    mapping(address => uint256) public balanceOf;
    function setBalance(address who, uint256 bal) external {
        balanceOf[who] = bal;
    }
}
`;

async function setupEnv() {
  const common = new Common({ chain: Mainnet, hardfork: Hardfork.Paris });
  const vm = await createVM({ common });

  for (const addr of [DEPLOYER, ALICE, BOB, CHARLIE]) {
    await vm.stateManager.putAccount(
      createAddressFromString(addr),
      new Account(0n, 10n ** 20n)
    );
  }

  // Compile and inject MockAgentID directly at the official BSC Agent ID Registry address
  const mockCompiled = compileSolidity('MockAgentID.sol', MOCK_AGENT_ID_SOL).MockAgentID;
  const mockAddr = createAddressFromString(AGENT_ID_ADDR);
  await vm.stateManager.putAccount(mockAddr, new Account(0n, 0n));
  await vm.stateManager.putCode(mockAddr, hexToBytes('0x' + mockCompiled.evm.deployedBytecode.object));
  const mockIface = new ethers.Interface(mockCompiled.abi);

  // Compile and deploy the exact production AgentShieldRegistry.sol
  const prodSource = fs.readFileSync(path.join(root, 'contracts', 'AgentShieldRegistry.sol'), 'utf8');
  const prodCompiled = compileSolidity('AgentShieldRegistry.sol', prodSource).AgentShieldRegistry;
  const prodIface = new ethers.Interface(prodCompiled.abi);

  const deployRes = await vm.evm.runCall({
    caller: createAddressFromString(DEPLOYER),
    data: hexToBytes('0x' + prodCompiled.evm.bytecode.object),
    gasLimit: 5_000_000n,
  });
  assert.equal(deployRes.execResult.exceptionError, undefined, 'deploy failed');
  const regAddr = deployRes.createdAddress;

  async function callContract(toAddr, caller, iface, fn, args = []) {
    const data = iface.encodeFunctionData(fn, args);
    const res = await vm.evm.runCall({
      to: toAddr,
      caller: createAddressFromString(caller),
      data: hexToBytes(data),
      gasLimit: 1_000_000n,
    });
    const returnHex = bytesToHex(res.execResult.returnValue);
    if (res.execResult.exceptionError) {
      let errName = res.execResult.exceptionError.error;
      try {
        const parsed = iface.parseError(returnHex);
        if (parsed) errName = parsed.name;
      } catch {}
      return { ok: false, errName, returnHex };
    }
    const decoded = iface.getFunction(fn).outputs.length
      ? iface.decodeFunctionResult(fn, returnHex)
      : null;
    return { ok: true, decoded, logs: res.execResult.logs || [] };
  }

  return {
    regAddr,
    regAddrStr: regAddr.toString(),
    setAgentBalance: (who, bal) => callContract(mockAddr, DEPLOYER, mockIface, 'setBalance', [who, bal]),
    callReg: (caller, fn, args) => callContract(regAddr, caller, prodIface, fn, args),
    deployedBytecode: '0x' + prodCompiled.evm.deployedBytecode.object,
  };
}

test('AgentShieldRegistry full positive & negative EVM suite', async () => {
  const env = await setupEnv();

  // 0. Bytecode embeds exact official BSC Agent ID Registry address
  assert.ok(
    env.deployedBytecode.toLowerCase().includes(AGENT_ID_ADDR.slice(2)),
    'runtime bytecode must embed official Agent ID registry'
  );

  // 1. Non-Agent-ID wallet (BOB) is blocked from both write functions
  const bobCheck = await env.callReg(BOB, 'hasAgentId', [BOB]);
  assert.equal(bobCheck.ok, true);
  assert.equal(bobCheck.decoded[0], false);

  const bobClaim = await env.callReg(BOB, 'claimSafeBadge', []);
  assert.equal(bobClaim.ok, false);
  assert.equal(bobClaim.errName, 'NotAgentIdHolder');

  const bobAudit = await env.callReg(BOB, 'submitAudit', [TARGET_A, true, 1, 'rug']);
  assert.equal(bobAudit.ok, false);
  assert.equal(bobAudit.errName, 'NotAgentIdHolder');

  // 2. Grant ALICE an Agent ID -> claimSafeBadge succeeds once, second claim reverts
  await env.setAgentBalance(ALICE, 1);
  assert.equal((await env.callReg(ALICE, 'hasAgentId', [ALICE])).decoded[0], true);

  const claim1 = await env.callReg(ALICE, 'claimSafeBadge', []);
  assert.equal(claim1.ok, true);
  assert.equal((await env.callReg(ALICE, 'totalBadges', [])).decoded[0], 1n);

  const claim2 = await env.callReg(ALICE, 'claimSafeBadge', []);
  assert.equal(claim2.ok, false);
  assert.equal(claim2.errName, 'AlreadyClaimedBadge');

  // 3. Anti-Sybil 1-wallet-1-vote + atomic vote flipping
  const auditRisk = await env.callReg(ALICE, 'submitAudit', [TARGET_A, true, 1, 'honeypot sell revert']);
  assert.equal(auditRisk.ok, true);
  let summary = (await env.callReg(ALICE, 'getTargetSummary', [TARGET_A])).decoded;
  assert.equal(summary.safeVotes, 0n);
  assert.equal(summary.riskVotes, 1n);
  assert.equal((await env.callReg(ALICE, 'totalAudits', [])).decoded[0], 1n);
  assert.equal((await env.callReg(ALICE, 'totalUniqueAuditors', [])).decoded[0], 1n);

  // Flip vote from RISK -> SAFE: totals stay 1, bucket flips cleanly
  const auditSafe = await env.callReg(ALICE, 'submitAudit', [TARGET_A, false, 0, 'verified safe']);
  assert.equal(auditSafe.ok, true);
  summary = (await env.callReg(ALICE, 'getTargetSummary', [TARGET_A])).decoded;
  assert.equal(summary.safeVotes, 1n);
  assert.equal(summary.riskVotes, 0n);
  assert.equal((await env.callReg(ALICE, 'totalAudits', [])).decoded[0], 1n);
  assert.equal((await env.callReg(ALICE, 'totalUniqueAuditors', [])).decoded[0], 1n);

  // 4. Second .ai holder (CHARLIE) votes RISK -> both buckets = 1, unique auditors = 2
  await env.setAgentBalance(CHARLIE, 1);
  const charlieAudit = await env.callReg(CHARLIE, 'submitAudit', [TARGET_A, true, 3, 'fake mint']);
  assert.equal(charlieAudit.ok, true);
  summary = (await env.callReg(CHARLIE, 'getTargetSummary', [TARGET_A])).decoded;
  assert.equal(summary.safeVotes, 1n);
  assert.equal(summary.riskVotes, 1n);
  assert.equal((await env.callReg(CHARLIE, 'totalAudits', [])).decoded[0], 2n);
  assert.equal((await env.callReg(CHARLIE, 'totalUniqueAuditors', [])).decoded[0], 2n);

  // 5. Boundary checks: zero address, self address, >120 byte note revert; exact 120 bytes passes
  const badZero = await env.callReg(ALICE, 'submitAudit', [ethers.ZeroAddress, true, 1, 'x']);
  assert.equal(badZero.ok, false);
  assert.equal(badZero.errName, 'InvalidTarget');

  const badSelf = await env.callReg(ALICE, 'submitAudit', [env.regAddrStr, true, 1, 'x']);
  assert.equal(badSelf.ok, false);
  assert.equal(badSelf.errName, 'InvalidTarget');

  const tooLong = await env.callReg(ALICE, 'submitAudit', [TARGET_A, true, 1, 'a'.repeat(121)]);
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.errName, 'NoteTooLong');

  const exactMax = await env.callReg(ALICE, 'submitAudit', [TARGET_A, true, 1, 'a'.repeat(120)]);
  assert.equal(exactMax.ok, true);
});
