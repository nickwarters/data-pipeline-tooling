// @ts-check

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);

/** @returns {string} */
function coverageCommand() {
  const packageJson = JSON.parse(
    readFileSync(new URL('package.json', ROOT), 'utf8')
  );
  return packageJson.scripts['test:coverage'];
}

/**
 * @param {string} command
 * @param {'lines' | 'branches' | 'functions'} metric
 * @returns {number}
 */
function threshold(command, metric) {
  const match = command.match(
    new RegExp(`--test-coverage-${metric}=([0-9]+(?:\\.[0-9]+)?)`)
  );
  assert.ok(match, `test:coverage must enforce a ${metric} threshold`);
  return Number(match[1]);
}

test('coverage contract: all production JavaScript is explicitly included', () => {
  const command = coverageCommand();

  assert.match(command, /--test-coverage-include='src\/\*\*\/\*\.js'/);
  assert.match(command, /--test-coverage-include='case-types\/\*\*\/\*\.js'/);
});

test('coverage contract: consistent global thresholds are enforced', () => {
  const command = coverageCommand();

  assert.deepEqual(
    {
      lines: threshold(command, 'lines'),
      branches: threshold(command, 'branches'),
      functions: threshold(command, 'functions'),
    },
    { lines: 95, branches: 95, functions: 95 }
  );
});
