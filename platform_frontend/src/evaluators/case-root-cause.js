// @ts-check
/**
 * Case Root Cause: the Root Cause Fields the Responsible Party Manager records
 * once for the whole Case, rather than once against each Issue.
 *
 * They live in the Case's `Answers` blob under one namespaced key, held in the
 * same `rcaCapture` shape a failed Answer carries, so the capture engine
 * validates, prunes and checks them with no rule of its own. The key is
 * namespaced because a Question Definition id may not contain `:`, so it can
 * never be mistaken for an Answer to a Question: every evaluator that walks the
 * catalogue — applicability, failure, progress, the Outcome — passes it by, and
 * the failed-Answer lifecycle never strips it.
 */

/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * The `Answers` key the Case Root Cause is stored under.
 */
export const CASE_ROOT_CAUSE_KEY = 'case:rootCause';

/**
 * What the Responsible Party Manager has recorded about the Case as a whole:
 * the stored `rcaCapture` map, or an empty one.
 *
 * @param {Record<string, Answer>} answers
 * @returns {NonNullable<Answer['rcaCapture']>}
 */
export function caseRootCauseCapture(answers) {
  return answers[CASE_ROOT_CAUSE_KEY]?.rcaCapture ?? {};
}
