// @ts-check
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * Returns true if the Answer matches the QuestionDefinition's failureCriteria.
 * For string values: equality match.
 * For string[] values (multi-choice): true if any element matches.
 *
 * @param {QuestionDefinition} question
 * @param {Answer | undefined} answer
 * @returns {boolean}
 */
export function isFailure(question, answer) {
  if (!question.failureCriteria) return false;
  if (!answer) return false;
  const v = answer.value;
  if (Array.isArray(v)) return v.includes(question.failureCriteria);
  return v === question.failureCriteria;
}

/**
 * Counts answers that match a configured failureCriteria. Questions with no
 * failureCriteria are informational for Outcome purposes, even when answered
 * with values like "No".
 *
 * @param {QuestionDefinition[]} questions
 * @param {Record<string, Answer>} answers
 * @returns {number}
 */
export function countConfiguredFailures(questions, answers) {
  let failures = 0;
  for (const q of questions) {
    if (isFailure(q, answers[q.id])) failures++;
  }
  return failures;
}

/**
 * Reconciles an Answer's failure-derived metadata with whether it is still a
 * failure. Configured remediation actions are available choices, not
 * selected choices, so a still-failing Answer keeps only the actions the
 * reviewer has selected onto the Answer. When the Answer is no
 * longer a failure, any stale `remediationActions`, `freeFormRemediation`,
 * `attributedParty`, `remediationDetails`, and `capture` are
 * stripped, so passing answers never carry leftover failure metadata. The
 * `attributedParty`, `remediationDetails`, and `capture` are kept on a
 * still-failing Answer even when the question defines no remediationActions.
 *
 * @param {QuestionDefinition} question
 * @param {Answer} answer
 * @returns {Answer}
 */
export function materializeRemediationActions(question, answer) {
  const failing = isFailure(question, answer);

  // The Attributed Party only survives while the Answer is a failure; a re-failed
  // Answer starts with none so the reviewer re-attributes.
  let result = answer;
  if (!failing && result.attributedParty) {
    const { attributedParty: _dropParty, ...rest } = result;
    result = rest;
  }

  // Remediation Details share the Attributed Party lifecycle: they
  // only survive while the Answer is a failure.
  if (!failing && result.remediationDetails) {
    const { remediationDetails: _dropDetails, ...rest } = result;
    result = rest;
  }

  // Issue Capture shares the same lifecycle: the unified capture map
  // only survives while the Answer is a failure.
  if (!failing && result.capture) {
    const { capture: _dropCapture, ...rest } = result;
    result = rest;
  }

  // A reviewer's free-form remediation shares the failure
  // lifecycle: it only survives while the Answer is a failure.
  if (!failing && result.freeFormRemediation !== undefined) {
    const { freeFormRemediation: _dropFree, ...rest } = result;
    result = rest;
  }

  if (!failing) {
    if (result.remediationActions) {
      const { remediationActions: _drop, ...rest } = result;
      return rest;
    }
    return result;
  }

  return result;
}
