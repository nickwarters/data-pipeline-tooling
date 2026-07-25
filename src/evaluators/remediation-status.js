// @ts-check
/**
 * The **question-level Remediation resolution** model (#499).
 *
 * A Reviewer attaches Remediation Actions to a *failed* Answer on the Issues
 * tab — either by ticking the Question Definition's configured actions
 * (`answer.remediationActions`) or by typing a free-form one
 * (`answer.freeFormRemediation`). Remediation is optional, so only some failed
 * Answers carry any.
 *
 * Once the actions have been sent, the Remediation tab tracks each *Question*
 * (not each individual action) to one of three resolutions —
 * `complete` · `partial` · `cancelled` — stored on the Answer as
 * `remediationStatus`. `partial` and `cancelled` each require the Reviewer's
 * free text (details / justification respectively); a row missing it is
 * *unresolved* and blocks completion of the Case.
 *
 * This module is the single place that reads that store, normalises it, and
 * derives both the tab's rows and the completion gate. It is pure: no DOM, no
 * persistence.
 */

import { evaluate } from './applicability-evaluator.js';
import { isFailure } from './failure-evaluator.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').RemediationStatus} RemediationStatus */
/** @typedef {import('../sharepoint-client.js').RemediationStatusValue} RemediationStatusValue */

/**
 * The resolution vocabulary, in display order.
 * @type {RemediationStatusValue[]}
 */
export const REMEDIATION_STATUSES = ['complete', 'partial', 'cancelled'];

/**
 * Viewer-facing wording for each resolution.
 * @type {Record<RemediationStatusValue, string>}
 */
export const REMEDIATION_STATUS_LABELS = {
  complete: 'Complete',
  partial: 'Partially complete',
  cancelled: 'Cancelled',
};

/**
 * The label for the free text each non-`complete` resolution requires. A
 * partially completed remediation needs *details*; a cancelled one needs a
 * *justification*.
 * @type {Record<'partial' | 'cancelled', string>}
 */
export const REMEDIATION_DETAIL_LABELS = {
  partial: 'Details',
  cancelled: 'Justification',
};

/**
 * @typedef {object} RemediationRow
 * @property {QuestionDefinition} question
 * @property {Array<{ id: string, text: string }>} actions The configured Remediation Actions the Reviewer selected.
 * @property {string} freeForm The Reviewer's free-form Remediation text, or `''`.
 * @property {RemediationStatusValue | null} status
 * @property {string} details The details / justification recorded with a non-`complete` status.
 */

/**
 * The remediation attached to one Answer, or `null` when it carries none.
 * Whitespace-only free-form text does not count as remediation.
 *
 * @param {Answer | undefined} answer
 * @returns {{ actions: Array<{ id: string, text: string }>, freeForm: string } | null}
 */
export function answerRemediation(answer) {
  const actions = (answer?.remediationActions ?? []).map((action) => ({
    id: action.id,
    text: action.text,
  }));
  const freeForm = (answer?.freeFormRemediation ?? '').trim();
  if (actions.length === 0 && freeForm === '') return null;
  return { actions, freeForm };
}

/**
 * Whether *any* Answer on the Case carries remediation. This is the visibility
 * gate for the Remediation Section: with nothing to track there is no tab.
 * Deliberately catalogue-free so `services/section-access.js` can call it with
 * the Case row alone.
 *
 * @param {Record<string, Answer>} answers
 * @returns {boolean}
 */
export function hasRemediation(answers) {
  return Object.values(answers ?? {}).some(
    (answer) => answerRemediation(answer) !== null
  );
}

/**
 * Normalise a stored `remediationStatus`, tolerating absent or unrecognised
 * values (both read as *unset*).
 *
 * @param {Answer | undefined} answer
 * @returns {{ status: RemediationStatusValue | null, details: string }}
 */
function readStatus(answer) {
  const raw = answer?.remediationStatus;
  const status = /** @type {RemediationStatusValue} */ (raw?.status);
  if (!raw || !REMEDIATION_STATUSES.includes(status)) {
    return { status: null, details: '' };
  }
  return { status, details: raw.details ?? '' };
}

/**
 * The Remediation tab's rows: every *applicable*, *failed* Question that
 * carries remediation, in catalogue order. Failed Questions without remediation
 * are excluded — attaching actions is optional.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {RemediationRow[]}
 */
export function remediationRows(catalogue, answers) {
  const applicable = evaluate(catalogue, answers ?? {});
  /** @type {RemediationRow[]} */
  const rows = [];
  for (const question of catalogue) {
    if (!applicable.has(question.id)) continue;
    const answer = (answers ?? {})[question.id];
    if (!isFailure(question, answer)) continue;
    const remediation = answerRemediation(answer);
    if (!remediation) continue;
    rows.push({ question, ...remediation, ...readStatus(answer) });
  }
  return rows;
}

/**
 * Record a resolution on one Answer, returning a fresh Answer. `complete`
 * carries no text, so any stale details are dropped; `partial` / `cancelled`
 * keep whatever text the Reviewer has typed *so far* — including none, which
 * leaves the row unresolved rather than throwing, so the select and its text
 * box can be filled in either order. An empty status clears the field; an
 * unrecognised one is ignored.
 *
 * @param {Answer} answer
 * @param {RemediationStatusValue | ''} status
 * @param {string} [details]
 * @returns {Answer}
 */
export function setRemediationStatus(answer, status, details = '') {
  if (status === '') {
    const { remediationStatus: _drop, ...rest } = answer;
    return rest;
  }
  if (!REMEDIATION_STATUSES.includes(status)) return answer;
  /** @type {RemediationStatus} */
  const next = { status };
  if (status !== 'complete') next.details = details;
  return { ...answer, remediationStatus: next };
}

/**
 * Whether a resolution is terminal: `complete`, or `partial` / `cancelled`
 * carrying the required text.
 *
 * @param {RemediationStatus | { status: RemediationStatusValue | null, details?: string } | null | undefined} status
 * @returns {boolean}
 */
export function isRemediationResolved(status) {
  if (!status) return false;
  if (status.status === 'complete') return true;
  if (status.status === 'partial' || status.status === 'cancelled') {
    return (status.details ?? '').trim() !== '';
  }
  return false;
}

/**
 * The completion gate: every remediation row resolved. Vacuously true when the
 * Case carries no remediation, so the no-actions path is never blocked.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {boolean}
 */
export function remediationComplete(catalogue, answers) {
  return remediationRows(catalogue, answers).every((row) =>
    isRemediationResolved(row)
  );
}
