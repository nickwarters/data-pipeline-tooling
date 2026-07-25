// @ts-check

import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TESTS_DIRECTORY = new URL('./', import.meta.url);

/**
 * `node --test` discovers `**\/*.test.js`, `**\/*-test.js`, `**\/*_test.js` and
 * `**\/test.js` — not `*.tests.js`. A test file named outside that glob runs
 * only if something imports it, so deleting the importer silently drops the
 * tests instead of failing. Everything else under `tests/` is support code and
 * carries the `_` prefix or lives in `tests/helpers/`.
 *
 * @param {URL} [directory]
 * @param {string} [prefix]
 * @returns {string[]}
 */
function strayTestFiles(directory = TESTS_DIRECTORY, prefix = 'tests') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === 'helpers'
        ? []
        : strayTestFiles(new URL(`${entry.name}/`, directory), path);
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) return [];
    const discoverable = entry.name.endsWith('.test.js');
    const support = entry.name.startsWith('_');
    return discoverable || support ? [] : [path];
  });
}

test('test discovery contract: every test file is found by node --test', () => {
  assert.deepEqual(
    strayTestFiles(),
    [],
    'These files under tests/ are neither discoverable by node --test (*.test.js) nor marked as support code (_ prefix or tests/helpers/). Rename them to *.test.js so they run on their own.'
  );
});
