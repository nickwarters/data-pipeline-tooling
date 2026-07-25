// @ts-check

import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TESTS_DIRECTORY = new URL('./', import.meta.url);
const THIS_FILE = 'tests/white-box-debt-contract.test.js';

const PATTERNS = [
  /\._children\b/g,
  /\._listeners\b/g,
  /\._[A-Za-z][A-Za-z0-9_]*\s*\(/g,
];
const ROUTER_INTERNAL_PATTERN = /\._(?:routes|container)\b/g;

/**
 * Existing debt only. Lower a count when a test is migrated; do not increase a
 * count unless the private structure is itself an intentional, named contract.
 */
// Tuple order: child structure, listener registry, underscore-prefixed call.
const BASELINE = {
  'tests/cora-amend-outcome.test.js': [2, 7, 0],
  'tests/cora-appeal-review.test.js': [1, 1, 0],
  'tests/cora-appeal.test.js': [4, 8, 0],
  'tests/cora-attribute-menu.test.js': [1, 0, 2],
  'tests/cora-dashboard.test.js': [3, 0, 0],
  'tests/cora-journey-cases.test.js': [2, 0, 0],
  'tests/dashboard-action-centre-view.test.js': [3, 0, 15],
  'tests/dashboard-controls-view.test.js': [2, 4, 0],
  'tests/dashboard-kpi-view.test.js': [3, 0, 6],
  'tests/cora-remediation-section-actions.test.js': [2, 0, 4],
  'tests/cora-remediation-section-attribution.test.js': [0, 0, 2],
  'tests/cora-remediation-section-details.test.js': [0, 0, 1],
  'tests/cora-remediation-section-rendering.test.js': [1, 0, 1],
  'tests/cora-remediation-tracking.test.js': [3, 0, 0],
  'tests/cora-responsible-party-dashboard-conversation.test.js': [0, 4, 0],
  'tests/cora-responsible-party-dashboard-loading.test.js': [3, 0, 0],
  'tests/cora-responsible-party-dashboard-remediation.test.js': [3, 2, 0],
  'tests/html.test.js': [1, 2, 0],
  'tests/http-sharepoint-client-protocol.test.js': [0, 0, 2],
  'tests/router.test.js': [3, 0, 0],
  'tests/routes-dashboard.test.js': [1, 0, 0],
  'tests/routes-journey-cases.test.js': [1, 0, 0],
  'tests/routes-my-cases.test.js': [1, 0, 0],
  'tests/simulate-panel.test.js': [1, 0, 0],
  'tests/uat-banner.test.js': [2, 0, 0],
};

const ROUTER_INTERNAL_BASELINE = {};

/**
 * @param {URL} directory
 * @param {string} prefix
 * @returns {string[]}
 */
function findTestFiles(directory, prefix = 'tests') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      return findTestFiles(new URL(`${entry.name}/`, directory), path);
    }
    return entry.isFile() && entry.name.endsWith('.test.js') ? [path] : [];
  });
}

/** @param {string} source @param {RegExp} pattern */
function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function currentDebt() {
  return Object.fromEntries(
    findTestFiles(TESTS_DIRECTORY)
      .filter((path) => path !== THIS_FILE)
      .sort()
      .map((path) => {
        const source = readFileSync(
          new URL(path.slice('tests/'.length), TESTS_DIRECTORY),
          'utf8'
        );
        return [path, PATTERNS.map((pattern) => countMatches(source, pattern))];
      })
      .filter(([, counts]) => /** @type {number[]} */ (counts).some(Boolean))
  );
}

function currentRouterInternalDebt() {
  return Object.fromEntries(
    findTestFiles(TESTS_DIRECTORY)
      .filter((path) => path !== THIS_FILE)
      .sort()
      .map((path) => {
        const source = readFileSync(
          new URL(path.slice('tests/'.length), TESTS_DIRECTORY),
          'utf8'
        );
        return [path, countMatches(source, ROUTER_INTERNAL_PATTERN)];
      })
      .filter(([, count]) => Number(count) > 0)
  );
}

test('white-box debt contract: structural coupling does not grow', () => {
  assert.deepEqual(
    currentDebt(),
    BASELINE,
    'White-box test debt changed. Replace new private access with semantic helpers; if debt was removed, lower the baseline in the same change.'
  );
});

test('white-box debt contract: router-internal coupling does not grow', () => {
  assert.deepEqual(
    currentRouterInternalDebt(),
    ROUTER_INTERNAL_BASELINE,
    'Router-internal test debt changed. Use register(), init(), navigate(), or a public router spy; if debt was removed, lower the baseline in the same change.'
  );
});
