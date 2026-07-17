// @ts-check

/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../../src/services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../../src/services/section-access.js').Section} Section */
/** @typedef {import('../../src/services/section-access.js').Role} Role */
/** @typedef {import('../../src/services/section-access.js').Mode} Mode */

import assert from 'node:assert/strict';

import {
  evaluateAccess,
  resolveRoles,
  showInSummary,
  SECTIONS,
  SUMMARY_SECTIONS,
} from '../../src/services/section-access.js';

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
 * A config declaring one `actions`-typed Issue Capture Field, so the Remediation
 * *tracking* Section (ADR-0024) can become visible.
 * @returns {CaseTypeConfig}
 */
export function makeActionsConfig(overrides = {}) {
  return makeConfig({
    captureGroups: [
      {
        key: 'g',
        label: 'G',
        fields: [{ key: 'acts', label: 'Actions', type: 'actions' }],
      },
    ],
    ...overrides,
  });
}

/**
 * A Case carrying one sent Remediation Action, so `hasSentActions` is true and the
 * Remediation tracking Section is not hidden.
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
export function makeCaseWithActions(overrides = {}) {
  return makeCase({
    answers: {
      q1: {
        value: 'No',
        capture: { acts: [{ id: 'a', text: 'do', status: 'pending' }] },
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
  evaluateAccess,
  resolveRoles,
  showInSummary,
  SECTIONS,
  SUMMARY_SECTIONS,
};
