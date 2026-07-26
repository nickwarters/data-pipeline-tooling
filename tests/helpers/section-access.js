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
  SECTIONS,
  SUMMARY_SECTIONS,
} from '../../src/services/section-access.js';

/**
 * The Case's resolved Question catalogue, holding the one Question the fixture
 * Cases below answer. The Remediation cells ask whether the tab would render a
 * row, which is a question about the catalogue and not only the Answers blob
 * (#502) — so a Case that carries remediation needs its Question to exist.
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

/** @returns {CaseRow} */
export function makeCase(overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'example-review',
    title: 'T',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'W/"1"',
    ...overrides,
  };
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
 * the one the Remediation Section's visibility gate reads (#499).
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
  return {
    isReviewer: false,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
    ...overrides,
  };
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

export {
  remediationAudience,
  resolveRoles,
  showInSummary,
  SECTIONS,
  SUMMARY_SECTIONS,
};
