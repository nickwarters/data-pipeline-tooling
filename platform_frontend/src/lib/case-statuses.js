// @ts-check

/**
 * Case lifecycle status values as persisted on `CaseRow.status`
 * (see `src/sharepoint-client.js`). Do not change these values — they are
 * persisted in SharePoint list rows and referenced by dev fixtures; a value
 * change here would silently corrupt already-saved Cases.
 *
 * Scope: this module covers Case row lifecycle status only. Other literal
 * families that happen to reuse the word "status" are separate domain
 * concepts and are out of scope:
 * - `RemediationAction.status` (`'pending' | 'complete' | 'cancelled'`) — the
 *   retired per-action record, see `src/sharepoint-client.js`. Its evaluator is
 *   gone; only the typedef survives, for blobs persisted under the old shape.
 * - `RemediationStatus.status` (`'complete' | 'partial' | 'cancelled'`) — the
 *   live question-level Remediation Resolution, see
 *   `src/evaluators/remediation-status.js`.
 * - `SaveQueue`'s own `'conflict'` status, see `src/services/save-queue.js`.
 *
 * `VOID` is terminal and has no way back: a Case abandoned mid-review is voided
 * with a reason, freezing it without ever reaching the reportable milestone, so
 * it carries no Outcome and never counts as reviewed work.
 */
import { CASE_STATUS } from '../sharepoint-client.js';
export { CASE_STATUS };

/**
 * @typedef {(typeof CASE_STATUS)[keyof typeof CASE_STATUS]} CaseStatus
 */
