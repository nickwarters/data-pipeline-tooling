// @ts-check
import { listCasesAcrossSources } from './across-sources.js';
import { CASE_STATUS } from '../lib/case-statuses.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

/**
 * Fan-out fetch across one or more Case Type lists, scoped by manager and by
 * the caller's optional Case Type filter. Each Case lives in exactly one list
 * (`source.listName`), so every `listCases` call carries an explicit
 * `{ listName }` and the per-list rows are merged client-side.
 *
 * @param {SharePointClient} client
 * @param {string | null} caseType the single Case Type to scope to, or null for all
 * @param {string} managerId
 * @param {CaseSource[]} sources
 * @returns {Promise<CaseRow[]>}
 */
export function fetchTeamCases(client, caseType, managerId, sources) {
  const targets = caseType
    ? sources.filter((s) => s.slug === caseType)
    : sources;

  return listCasesAcrossSources(client, targets, (target) => ({
    caseType: target.slug,
    assignedReviewerManager: managerId,
  }));
}

/**
 * Read the live manager workload across the same manager-scoped, per-source
 * fan-out as Team Cases, without borrowing that page's URL filter contract.
 * Outstanding and hold rules stay in the pure workload evaluator.
 *
 * @param {SharePointClient} client
 * @param {string} managerId
 * @param {CaseSource[]} sources
 * @returns {Promise<CaseRow[]>}
 */
export function fetchTeamWorkloadCases(client, managerId, sources) {
  return listCasesAcrossSources(client, sources, (source) => ({
    caseType: source.slug,
    assignedReviewerManager: managerId,
  }));
}

/**
 * Read the Cases a manager's team has voided since `since`, across the same
 * per-source fan-out. One 30-day window answers both of the report's columns:
 * the shorter split is derived client-side rather than read a second time.
 *
 * @param {SharePointClient} client
 * @param {string} managerId
 * @param {CaseSource[]} sources
 * @param {string} since ISO instant; the inclusive start of the window
 * @returns {Promise<CaseRow[]>}
 */
export function fetchTeamVoidedCases(client, managerId, sources, since) {
  return listCasesAcrossSources(client, sources, (source) => ({
    caseType: source.slug,
    assignedReviewerManager: managerId,
    status: CASE_STATUS.VOID,
    voidedAfter: since,
  }));
}
