// @ts-check

/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../../src/services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../../src/services/section-access.js').Section} Section */
/** @typedef {import('../../src/services/section-access.js').Role} Role */
/** @typedef {import('../../src/services/section-access.js').Mode} Mode */

import assert from 'node:assert/strict';

import {
  evaluateAccess as evaluateAccessWithCatalogue,
  MATRIX,
  remediationAudience,
  resolveRoles,
  showInSummary,
  summarySectionsFor,
  ROLES,
  SECTIONS,
  SUMMARY_SECTIONS,
} from '../../src/services/section-access.js';

import { makeCaseRow, makePermissions } from './fixtures.js';

/**
 * The Case's resolved Question catalogue, holding the one Question the fixture
 * Cases below answer. The Remediation cells ask whether the tab would render a
 * row, which is a question about the catalogue and not only the Answers blob
 * — so a Case that carries remediation needs its Question to exist.
 *
 * @type {import('../../src/sharepoint-client.js').QuestionDefinition[]}
 */
export const CATALOGUE = [
  {
    id: 'q1',
    text: 'Greeted the customer?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
];

/**
 * `evaluateAccess` against `CATALOGUE` unless a test supplies its own — the
 * ordinary case being that the Case's Questions are loaded.
 *
 * **This default is the shim's, not production's.** `evaluateAccess` in
 * `src/services/section-access.js` defaults `catalogue` to `[]` and so fails
 * closed: no Questions, no remediation rows, no Remediation Section. A test that
 * wants that path must pass `[]` explicitly — importing this helper and omitting
 * the argument silently supplies a populated catalogue instead, which is the
 * opposite of the production default. `section-access-lifecycle.test.js` covers
 * the fail-closed path directly.
 *
 * @param {Section} section
 * @param {Role[]} roles
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} config
 * @param {import('../../src/sharepoint-client.js').QuestionDefinition[]} [catalogue]
 * @returns {Mode}
 */
export function evaluateAccess(
  section,
  roles,
  caseRow,
  config,
  catalogue = CATALOGUE
) {
  return evaluateAccessWithCatalogue(
    section,
    roles,
    caseRow,
    config,
    catalogue
  );
}

/**
 * The shared Case fixture, narrowed to what these suites pair it with: the
 * `example-review` Case Type `makeConfig`/`CATALOGUE` below describe.
 *
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
export function makeCase(overrides = {}) {
  return makeCaseRow({
    caseType: 'example-review',
    title: 'T',
    etag: 'W/"1"',
    ...overrides,
  });
}

/** @returns {CaseTypeConfig} */
export function makeConfig(overrides = {}) {
  return {
    questions: [],
    computeOutcome: () => ({ outcome: 'pass' }),
    outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
    defaultOutcomeId: 'pass',
    ...overrides,
  };
}

/**
 * A Case whose failed Answer carries a Reviewer-selected Remediation Action —
 * the store the Issues tab actually writes (`answer.remediationActions`), and so
 * the one the Remediation Section's visibility gate reads.
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
export function makeCaseWithRemediation(overrides = {}) {
  return makeCase({
    answers: {
      q1: {
        value: 'No',
        remediationActions: [{ id: 'a', text: 'Call back' }],
      },
    },
    ...overrides,
  });
}

/** @returns {import('../../src/sharepoint-client.js').Appeal} */
export function openAppeal() {
  return {
    id: 'ap1',
    appellant: 'someone',
    at: '2026-07-01T00:00:00Z',
    rationale: 'wrong outcome',
    state: 'raised',
  };
}

/** @returns {import('../../src/sharepoint-client.js').Appeal} */
export function resolvedAppeal() {
  return { ...openAppeal(), state: 'resolved' };
}

/**
 * Build a Capabilities object with everything off by default.
 * @param {Partial<Capabilities>} [overrides]
 * @returns {Capabilities}
 */
export function caps(overrides = {}) {
  return makePermissions({ isReviewer: false, ...overrides });
}

/**
 * Assert `evaluateAccess` for every (section, role) pair in an expected grid.
 * @param {Partial<Record<Section, Partial<Record<Role, Mode>>>>} grid
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} config
 */
export function assertGrid(grid, caseRow, config) {
  for (const section of /** @type {Section[]} */ (Object.keys(grid))) {
    const row = grid[section];
    if (!row) continue;
    for (const role of /** @type {Role[]} */ (Object.keys(row))) {
      assert.equal(
        evaluateAccess(section, [role], caseRow, config),
        row[role],
        `${section} × ${role}`
      );
    }
  }
}

/**
 * The access policy one `MATRIX` cell states, read without going through
 * `evaluateAccess`.
 *
 * This exists for the Appeal Sections and nothing else. Appeals are switched
 * off in this build, so `evaluateAccess` answers `hidden` for both of them
 * ahead of the matrix — which is the behaviour the app must have, and is
 * asserted as such in `appeals-feature-switch.test.js`. But the rows themselves
 * are the policy Appeals resume under, and a policy nothing exercises is a
 * policy that rots: the raiser default, the Completed-only gate, the
 * no-Appeal-yet and resolved-Appeal modes would all go untested for as long as
 * the switch stands, and be rediscovered by whoever removes it.
 *
 * So the Appeal cells are tested here at the matrix, and the switch is tested
 * at `evaluateAccess`. When the switch goes, these callers can move back to
 * `assertGrid`/`evaluateAccess` unchanged in expectation.
 *
 * @param {Section} section
 * @param {Role} role
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} config
 * @returns {Mode}
 */
export function matrixMode(section, role, caseRow, config) {
  const cell = MATRIX[section][role];
  return typeof cell === 'function' ? cell(caseRow, config, CATALOGUE) : cell;
}

/**
 * `assertGrid`, but reading the `MATRIX` rows directly — see `matrixMode`.
 *
 * @param {Partial<Record<Section, Partial<Record<Role, Mode>>>>} grid
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} config
 */
export function assertMatrixGrid(grid, caseRow, config) {
  for (const section of /** @type {Section[]} */ (Object.keys(grid))) {
    const row = grid[section];
    if (!row) continue;
    for (const role of /** @type {Role[]} */ (Object.keys(row))) {
      assert.equal(
        matrixMode(section, role, caseRow, config),
        row[role],
        `${section} × ${role} (matrix policy)`
      );
    }
  }
}

export {
  remediationAudience,
  resolveRoles,
  showInSummary,
  summarySectionsFor,
  ROLES,
  SECTIONS,
  SUMMARY_SECTIONS,
};
