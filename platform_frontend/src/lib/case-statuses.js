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
 * `TO_ALLOCATE` is where a Case starts: ingested, waiting in its Case Type's
 * list for a Reviewer to claim it. It is the status the allocation claim reads
 * and the status the claim replaces with `IN_PROGRESS`, so "nobody has this
 * yet" is a value on the indexed Status column rather than something inferred
 * from an empty Assigned Reviewer. It carries no Assigned Reviewer and no
 * review clock — the Due Date is stamped at the claim — so no review SLA runs
 * against it.
 *
 * `VOID` is terminal and has no way back: a Case abandoned mid-review is voided
 * with a reason, freezing it without ever reaching the reportable milestone, so
 * it carries no Outcome and never counts as reviewed work.
 */
export const CASE_STATUS = Object.freeze(
  /** @type {const} */ ({
    TO_ALLOCATE: 'To-allocate',
    IN_PROGRESS: 'In-progress',
    ACTIONS_IN_PROGRESS: 'Actions In Progress',
    COMPLETED: 'Completed',
    VOID: 'Void',
  })
);

/**
 * @typedef {(typeof CASE_STATUS)[keyof typeof CASE_STATUS]} CaseStatus
 */

/**
 * The statuses a Reviewer still holds work in — a review under way, or its
 * Remediation Actions out with the Responsible Party. Declared once because
 * every consumer of it must agree: the Outstanding Cases panel queries it and
 * offers it as filter choices, the workload model counts it, and the Action
 * Centre's In progress group is grouped by it. A consumer naming one status
 * fewer silently drops a Case someone is still accountable for.
 *
 * @type {CaseStatus[]}
 */
export const OUTSTANDING_STATUSES = [
  CASE_STATUS.IN_PROGRESS,
  CASE_STATUS.ACTIONS_IN_PROGRESS,
];
