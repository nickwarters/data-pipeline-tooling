#!/usr/bin/env node
// @ts-check

import { readFile, writeFile } from 'node:fs/promises';
import { runFlowFixture } from '../src/testing/in-memory-flow-runner.js';

const args = parseArgs(process.argv.slice(2));

if (!args.input || !args.output) {
  console.error(
    'Usage: node scripts/run_in_memory_flow.js --input flow.json --output state-out.json'
  );
  process.exit(1);
}

const fixture = JSON.parse(await readFile(args.input, 'utf8'));
const snapshot = await runFlowFixture(fixture);
await writeFile(args.output, `${JSON.stringify(snapshot, null, 2)}\n`);

/**
 * @param {string[]} argv
 * @returns {{ input?: string, output?: string }}
 */
function parseArgs(argv) {
  /** @type {{ input?: string, output?: string }} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      out.input = argv[++i];
    } else if (arg === '--output') {
      out.output = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}
