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
  remediationAudience,
  resolveRoles,
  showInSummary,
  summarySectionsFor,
  ROLES,
  SECTIONS,
  SUMMARY_SECTIONS,
} from '../../src/services/section-access.js';

import { makeCaseRow, makePermissions } from './fixtures.js';
import { getSectionPlugin } from '../../src/sections/registry.js';

/**
 * Fixture: Question catalogue with one Yes/No failure.
 *
 * Stamped on a Case so the Remediation Section has a Question to evaluate:
 * without a catalogue, or without a failure in it, the Remediation cells
 * resolve `hidden` regardless of status or role.
 *
 * @type {import('../../src/sharepoint-client.js').QuestionDefinition[]}\n */
export const CATALOGUE = [
  {
    id: 'q1',
    text: 'A Question?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
];

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
 *
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
 *
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
 * The access policy one plugin states, read directly without going through
 * `evaluateAccess`.
 *
 * This exists for the Appeal Sections and nothing else. Appeals are switched
 * off in this build, so `evaluateAccess` answers `hidden` for both of them
 * ahead of the plugin \u2014 which is the behaviour the app must have, and is
 * asserted as such in `appeals-feature-switch.test.js`. But the access rules
 * themselves are the policy Appeals resume under, and a policy nothing exercises
 * is a policy that rots: the raiser default, the Completed-only gate, the
 * no-Appeal-yet and resolved-Appeal modes would all go untested for as long as
 * the switch stands, and be rediscovered by whoever removes it.
 *
 * So the Appeal cells are tested here at the plugin directly, and the switch is tested
 * at `evaluateAccess`. When the switch goes, these callers can move back to
 * `assertGrid`/`evaluateAccess` unchanged in expectation.
 *
 * @param {Section} section
 * @param {Role | Role[]} role
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} config
 * @returns {Mode}
 */
export function matrixMode(section, role, caseRow, config) {
  const plugin = getSectionPlugin(section);
  if (!plugin) throw new Error(`Unknown section plugin: ${section}`);
  const roles = Array.isArray(role) ? role : [role];
  return plugin.evaluateAccess({
    caseRow,
    roles,
    config,
    sectionConfig: {
      appealsEnabled: true,
      ...(config?.sections?.[section] ?? {}),
    },
    catalogue: CATALOGUE,
  });
}

/**
 * `assertGrid`, but reading the plugin policies directly — see `matrixMode`.
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
        `${section} × ${role} (plugin policy)`
      );
    }
  }
}

/**
 * Call `evaluateAccess` with `CATALOGUE` supplied so Remediation cells can
 * evaluate properly.
 *
 * @param {Section} section
 * @param {Role[]} roles
 * @param {CaseRow} caseRow
 * @param {CaseTypeConfig} config
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

export {
  remediationAudience,
  resolveRoles,
  showInSummary,
  summarySectionsFor,
  ROLES,
  SECTIONS,
  SUMMARY_SECTIONS,
};
