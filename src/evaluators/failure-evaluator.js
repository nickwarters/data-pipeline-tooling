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
 * If the answer is a failure and the question has remediationActions defined,
 * returns a fresh materialized Answer with `remediationActions` populated as
 * { id, text, completed: false } items. Otherwise returns the answer unchanged
 * (with any prior remediationActions stripped, so passing answers don't carry
 * stale failure metadata).
 *
 * @param {QuestionDefinition} question
 * @param {Answer} answer
 * @returns {Answer}
 */
export function materializeRemediationActions(question, answer) {
  if (!isFailure(question, answer) || !question.remediationActions?.length) {
    if (answer.remediationActions) {
      const { remediationActions: _drop, ...rest } = answer;
      return rest;
    }
    return answer;
  }
  return {
    ...answer,
    remediationActions: question.remediationActions.map((text, i) => ({
      id: `${question.id}-ra-${i}`,
      text,
      completed: false,
    })),
  };
}
