// @ts-check

/**
 * The one place a test-side shape change lands.
 *
 * A Case row, a capabilities object and the chrome slice were each hand-built
 * dozens of times across the suite, so adding a required field to any of them
 * cost hundreds of edited test lines and a long tail of half-migrated files.
 * Build them here instead: each factory returns a complete, type-valid default
 * that the caller narrows with overrides, so a suite states only what it is
 * actually asserting on.
 *
 * Only the REQUIRED fields are defaulted. Optional Case fields — `dueDate`,
 * `overdue`, `appeals` and the rest — stay absent on purpose: giving them a
 * value here would quietly flip branches in the overdue, action-centre and KPI
 * evaluators across every suite that never asked for them.
 */

/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../src/sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../../src/services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../../src/core/chrome-state.js').ChromeState} ChromeState */

import { CASE_STATUS } from '../../src/lib/case-statuses.js';

/**
 * Shared by `makeChrome`'s `currentUser.id` and `makeCaseRow`'s
 * `assignedReviewer` — Section access matches the signed-in account against the
 * row, so the two agreeing is what makes the default posture an assigned
 * Reviewer on their own Case.
 */
export const REVIEWER = 'user-reviewer';

/** The default Case row's Responsible Party identity. */
export const RESPONSIBLE_PARTY = 'user-rp';

/**
 * A complete Case row. Defaults are rebuilt on every call rather than spread
 * from a shared constant, because `answers` and `conversation` are mutated in
 * place by the mock client's `patchCase` and by the flow runner — sharing them
 * would make test order significant.
 *
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
export function makeCaseRow(overrides = {}) {
  return {
    id: 'case-1',
    caseType: 'complaints',
    title: 'Case 1',
    status: CASE_STATUS.IN_PROGRESS,
    assignedReviewer: REVIEWER,
    responsibleParty: RESPONSIBLE_PARTY,
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-1',
    ...overrides,
  };
}

/**
 * A complete capabilities object posturing as an ordinary Reviewer: every other
 * capability off and every list empty, so a suite opts in to what it needs.
 *
 * @param {Partial<Capabilities>} [overrides]
 * @returns {Capabilities}
 */
export function makePermissions(overrides = {}) {
  return {
    isReviewer: true,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    canSearchCases: false,
    isVisitor: false,
    ...overrides,
  };
}

/**
 * The shared chrome slice. Merging is one level deep only: `currentUser` and
 * `permissions` each merge over their own defaults, but nothing nested inside
 * them does, so `makeChrome({ permissions: { isControls: true } })` keeps the
 * rest of the Reviewer posture.
 *
 * @param {{ currentUser?: Partial<CurrentUser>, permissions?: Partial<Capabilities> }} [overrides]
 * @returns {ChromeState}
 */
export function makeChrome(overrides = {}) {
  return {
    currentUser: {
      id: REVIEWER,
      displayName: 'Reviewer One',
      ...overrides.currentUser,
    },
    permissions: makePermissions(overrides.permissions),
  };
}
