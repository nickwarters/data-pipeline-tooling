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
  'tests/accessibility.test.js': [20, 0, 0],
  'tests/app-chrome.test.js': [7, 0, 0],
  'tests/cora-action-centre.test.js': [3, 0, 15],
  'tests/cora-allocation.test.js': [6, 1, 14],
  'tests/cora-amend-outcome.test.js': [2, 8, 0],
  'tests/cora-app-nav.test.js': [1, 0, 0],
  'tests/cora-appeal-review.test.js': [1, 1, 0],
  'tests/cora-appeal.test.js': [4, 8, 0],
  'tests/cora-attribute-menu.test.js': [1, 0, 3],
  'tests/cora-bank-dock.test.js': [19, 2, 0],
  'tests/cora-bank-editor.test.js': [1, 0, 0],
  'tests/cora-capture-groups.test.js': [1, 0, 14],
  'tests/cora-case-details.test.js': [7, 2, 0],
  'tests/cora-case-review-controllers-completion.tests.js': [0, 6, 0],
  'tests/cora-case-review-controllers-conversation.tests.js': [0, 1, 0],
  'tests/cora-case-review-controllers-issues.tests.js': [0, 4, 0],
  'tests/cora-case-review-controllers-questions.tests.js': [5, 3, 0],
  'tests/cora-case-review-controllers-remediation-tracking.tests.js': [0, 1, 0],
  'tests/cora-case-review-controllers-shell.tests.js': [9, 1, 0],
  'tests/cora-case-tabs.test.js': [18, 3, 0],
  'tests/cora-command-palette.test.js': [5, 2, 0],
  'tests/cora-controls-dashboard.test.js': [2, 4, 0],
  'tests/cora-conversation-view.test.js': [8, 1, 0],
  'tests/cora-conversation.test.js': [2, 8, 6],
  'tests/cora-dashboard.test.js': [3, 4, 2],
  'tests/cora-home.test.js': [1, 0, 0],
  'tests/cora-journey-cases.test.js': [2, 0, 0],
  'tests/cora-kpi-strip.test.js': [3, 0, 6],
  'tests/cora-notes.test.js': [4, 14, 0],
  'tests/cora-outcome.test.js': [17, 0, 0],
  'tests/cora-owner-summary.test.js': [3, 0, 0],
  'tests/cora-people-picker.test.js': [11, 0, 13],
  'tests/cora-remediation-section-actions.tests.js': [2, 0, 4],
  'tests/cora-remediation-section-attribution.tests.js': [0, 0, 2],
  'tests/cora-remediation-section-capture.tests.js': [0, 0, 1],
  'tests/cora-remediation-section-details.tests.js': [0, 0, 1],
  'tests/cora-remediation-section-rendering.tests.js': [1, 0, 1],
  'tests/cora-remediation-tracking.test.js': [3, 0, 3],
  'tests/cora-responsible-party-dashboard-conversation.tests.js': [0, 4, 0],
  'tests/cora-responsible-party-dashboard-loading.tests.js': [3, 0, 0],
  'tests/cora-responsible-party-dashboard-remediation.tests.js': [3, 2, 0],
  'tests/cora-reviewer-team-report.test.js': [4, 0, 0],
  'tests/cora-status-banner.test.js': [12, 1, 0],
  'tests/cora-summary.test.js': [13, 0, 0],
  'tests/cora-tabs.test.js': [4, 0, 11],
  'tests/cora-team-cases.test.js': [2, 0, 1],
  'tests/cora-toast.test.js': [4, 0, 0],
  'tests/html.test.js': [1, 2, 0],
  'tests/http-sharepoint-client-protocol.test.js': [0, 0, 2],
  'tests/router.test.js': [3, 0, 0],
  'tests/routes-conversation.test.js': [2, 0, 0],
  'tests/routes-dashboard.test.js': [1, 0, 0],
  'tests/routes-journey-cases.test.js': [1, 0, 0],
  'tests/routes-my-cases.test.js': [1, 0, 0],
  'tests/routes-root.test.js': [3, 0, 0],
  'tests/routes-team-cases.test.js': [1, 0, 0],
  'tests/simulate-panel.test.js': [1, 0, 0],
  'tests/uat-banner.test.js': [2, 0, 0],
  'tests/view.test.js': [19, 0, 0],
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
    return entry.isFile() &&
      (entry.name.endsWith('.test.js') || entry.name.endsWith('.tests.js'))
      ? [path]
      : [];
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
