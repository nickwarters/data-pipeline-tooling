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
 * Reconciles an Answer's failure-derived metadata with whether it is still a
 * failure (ADR-0013). When the Answer remains a failure and the question has
 * remediationActions defined, returns a fresh Answer with `remediationActions`
 * populated as { id, text, completed: false } items. When the Answer is no
 * longer a failure, any stale `remediationActions` and `attributedParty` are
 * stripped, so passing answers never carry leftover failure metadata. The
 * `attributedParty` is kept on a still-failing Answer even when the question
 * defines no remediationActions.
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

  if (!failing || !question.remediationActions?.length) {
    if (result.remediationActions) {
      const { remediationActions: _drop, ...rest } = result;
      return rest;
    }
    return result;
  }
  return {
    ...result,
    remediationActions: question.remediationActions.map((text, i) => ({
      id: `${question.id}-ra-${i}`,
      text,
      completed: false,
    })),
  };
}
