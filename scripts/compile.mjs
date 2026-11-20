#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'contracts', 'AgentShieldRegistry.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'AgentShieldRegistry.sol': { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors || [];
const fatal = errors.filter((e) => e.severity === 'error');
for (const e of errors) {
  console.error(e.formattedMessage);
}
if (fatal.length > 0) {
  process.exit(1);
}

const compiled = output.contracts['AgentShieldRegistry.sol'].AgentShieldRegistry;
const bytecode = '0x' + compiled.evm.bytecode.object;
const deployedBytecode = '0x' + compiled.evm.deployedBytecode.object;

const EXPECTED_REGISTRY = '60b9262456de011f7d15a54cdd8c48baaa8b022f';
if (!deployedBytecode.toLowerCase().includes(EXPECTED_REGISTRY)) {
  console.error(`ERROR: deployed bytecode does not embed Agent ID registry ${EXPECTED_REGISTRY}`);
  process.exit(1);
}

const artifactsDir = path.join(root, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });
const outPath = path.join(artifactsDir, 'AgentShieldRegistry.json');
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      contractName: 'AgentShieldRegistry',
      solcVersion: '0.8.24',
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 200 },
      agentIdRegistry: '0x' + EXPECTED_REGISTRY,
      abi: compiled.abi,
      bytecode,
      deployedBytecode,
    },
    null,
    2
  )
);

console.log(
  `Compiled AgentShieldRegistry successfully: runtime=${deployedBytecode.length / 2 - 1} bytes, embeds AgentID registry 0x${EXPECTED_REGISTRY}`
);
