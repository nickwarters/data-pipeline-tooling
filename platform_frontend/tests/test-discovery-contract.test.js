// @ts-check

import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TESTS_DIRECTORY = new URL('./', import.meta.url);

/**
 * `node --test` discovers `**\/*.test.js`, `**\/*-test.js`, `**\/*_test.js` and
 * `**\/test.js` — not `*.tests.js` or `*.perf.js`. The opt-in performance
 * suite lives only under `tests/perf/`; naming a default test there would make
 * it part of the default run, while naming a performance test elsewhere would
 * make it look like a silently dropped test. Everything else under `tests/` is
 * support code and carries the `_` prefix or lives in `tests/helpers/`.
 *
 * @param {URL} [directory]
 * @param {string} [prefix]
 * @returns {string[]}
 */
function strayTestFiles(directory = TESTS_DIRECTORY, prefix = 'tests') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      return path === 'tests/helpers'
        ? []
        : strayTestFiles(new URL(`${entry.name}/`, directory), path);
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) return [];
    const inPerf = prefix === 'tests/perf' || prefix.startsWith('tests/perf/');
    const performanceTest = entry.name.endsWith('.perf.js');
    if (inPerf) return performanceTest ? [] : [path];
    if (performanceTest) return [path];
    const discoverable = entry.name.endsWith('.test.js');
    const support = entry.name.startsWith('_');
    return discoverable || support ? [] : [path];
  });
}

test('test discovery contract: every test file is found by node --test', () => {
  assert.deepEqual(
    strayTestFiles(),
    [],
    'These files violate test discovery: default tests must be *.test.js, support code must use an _ prefix or tests/helpers/, and opt-in performance tests must be tests/perf/**/*.perf.js with no *.test.js files under tests/perf/.'
  );
});
