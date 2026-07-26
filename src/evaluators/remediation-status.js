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
import { answerRemediation } from './answer-remediation.js';

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

// `answerRemediation` answers the one question that *can* be answered from the
// Answers blob alone — what remediation is written against **one** Answer — so
// it lives in a leaf module the Responsible Party dashboard can import without
// dragging the applicability graph and failure rules behind it. It is
// re-exported here so this module stays the seam callers name.
//
// There is deliberately no Answers-blob-only "does this Case carry remediation?"
// predicate. That question is catalogue-aware: see `hasTrackableRemediation`.
export { answerRemediation };

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
 * The last result, keyed by the identity of the inputs that produced it. Both
 * the tab and the completion gate ask for the rows on every render — and the
 * details textarea re-renders on every keystroke — so without this the
 * applicability graph is walked twice per character typed.
 *
 * Keying on identity is safe **because Answers are replaced, never mutated in
 * place**: every writer (`handleRemediationStatus` and its siblings, the reducer)
 * builds a fresh map. Code that edits an Answers map in place would read a stale
 * row set. One entry, so navigating to another Case simply replaces it.
 *
 * @type {{ catalogue: QuestionDefinition[], answers: Record<string, Answer>, rows: RemediationRow[] } | null}
 */
let rowsCache = null;

/**
 * The Remediation tab's rows: every *applicable*, *failed* Question that
 * carries remediation, in catalogue order. Failed Questions without remediation
 * are excluded — attaching actions is optional.
 *
 * Repeated calls with the same catalogue and Answers *references* return the same
 * array, so callers may treat the result as stable within a render.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {RemediationRow[]}
 */
export function remediationRows(catalogue, answers) {
  if (
    rowsCache &&
    rowsCache.catalogue === catalogue &&
    rowsCache.answers === answers
  ) {
    return rowsCache.rows;
  }
  // A deprecated Question Definition is out of the catalogue, not in it with a
  // flag: Question Definitions are never deleted (CLAUDE.md), so deprecation is
  // how a Case Type Owner retires one. `case-review-view-model.js` already
  // filters them on both the live and the versioned path; filtering here too
  // makes the seam correct for any caller rather than only the careful one.
  const active = catalogue.filter((question) => !question.deprecated);
  const applicable = evaluate(active, answers ?? {});
  /** @type {RemediationRow[]} */
  const rows = [];
  for (const question of active) {
    if (!applicable.has(question.id)) continue;
    const answer = (answers ?? {})[question.id];
    if (!isFailure(question, answer)) continue;
    const remediation = answerRemediation(answer);
    if (!remediation) continue;
    rows.push({ question, ...remediation, ...readStatus(answer) });
  }
  rowsCache = { catalogue, answers, rows };
  return rows;
}

/**
 * **The** definition of "this Case carries remediation" (#502, #497): it has at
 * least one row on the Remediation tab. Everything that turns on the question —
 * the **Send Actions** fork and its `hadRemediation` stamp, the Remediation
 * Section's visibility gate, the completion gate — reads it here, so a Case
 * cannot be sent down the actions path for remediation the tab will not render
 * and nobody can ever resolve.
 *
 * It is deliberately **catalogue-aware**, and that is the whole content of the
 * decision. Remediation attached to a Question that has since left the
 * catalogue — deprecated by a Case Type Owner, no longer applicable, or no
 * longer failing after a republished bank changed its `optionOutcomes` — is
 * *orphaned*, not outstanding. `materializeRemediationActions` already strips
 * remediation the moment an Answer stops failing; this is the same rule applied
 * to the cases that rule cannot reach, because the Question is no longer there
 * to iterate over.
 *
 * An absent catalogue is no Questions, hence no remediation. Callers that hold
 * a resolved catalogue must pass it: reading the Answers blob alone gives a
 * strict *superset* of the rows, which is exactly the split this seam exists to
 * close.
 *
 * @param {QuestionDefinition[] | null | undefined} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {boolean}
 */
export function hasTrackableRemediation(catalogue, answers) {
  return remediationRows(catalogue ?? NO_CATALOGUE, answers).length > 0;
}

/** One shared empty catalogue, so the absent-catalogue path does not evict `rowsCache` on every call. */
const NO_CATALOGUE = /** @type {QuestionDefinition[]} */ ([]);

/**
 * Record a resolution on one Answer, returning a fresh Answer. `complete`
 * carries no text, so any stale details are dropped; `partial` / `cancelled`
 * keep whatever text the Reviewer has typed *so far* — including none, which
 * leaves the row unresolved rather than throwing, so the select and its text
 * box can be filled in either order. An empty status clears the field; an
 * unrecognised one is ignored.
 *
 * Returns the *same* Answer when nothing changes — clearing a row that was never
 * resolved, or an unrecognised status — so the caller's identity check can skip
 * the write rather than PATCHing the Answers blob for a no-op.
 *
 * @param {Answer} answer
 * @param {RemediationStatusValue | ''} status
 * @param {string} [details]
 * @returns {Answer}
 */
export function setRemediationStatus(answer, status, details = '') {
  if (status === '') {
    if (!answer.remediationStatus) return answer;
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
