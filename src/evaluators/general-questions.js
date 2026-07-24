// @ts-check
/**
 * General Questions: the answer-key namespace that keeps them out of every
 * catalogue-driven evaluator, and the load-time checks that keep that promise
 * true rather than merely intended.
 */

/** @typedef {import('../sharepoint-client.js').GeneralQuestionField} GeneralQuestionField */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * The namespace every General Question answer key carries inside the Case's
 * `Answers` blob. A Question Definition id may not contain `:` (enforced by
 * `validateAnswerKeyNamespace`), so a namespaced key cannot collide with one —
 * which is what lets the two kinds of answer share one blob.
 */
export const GENERAL_ANSWER_PREFIX = 'general:';

/**
 * The field types a General Question may declare. Narrower than the full
 * `CaptureField` vocabulary on purpose: `person` and `actions` fall through to
 * a plain text box in `buildCaptureControl`, and a Case Type Owner should be
 * told that rather than shipping a silently degraded field.
 */
export const GENERAL_QUESTION_TYPES = ['text', 'textarea', 'select', 'radio'];

/**
 * @param {string} fieldKey
 * @returns {string}
 */
export function generalAnswerKey(fieldKey) {
  return `${GENERAL_ANSWER_PREFIX}${fieldKey}`;
}

/**
 * Load-time check on a Case Type's declared General Questions: every `key` is
 * unique (duplicates would silently share one answer) and every `type` is one
 * this section actually renders. Throws on the first problem.
 *
 * @param {GeneralQuestionField[] | undefined} fields
 */
export function validateGeneralQuestions(fields) {
  /** @type {Set<string>} */
  const seen = new Set();
  for (const field of fields ?? []) {
    if (seen.has(field.key)) {
      throw new Error(
        `Duplicate General Question key "${field.key}" — keys are answer keys, so they must be unique.`
      );
    }
    seen.add(field.key);
    if (!GENERAL_QUESTION_TYPES.includes(field.type)) {
      throw new Error(
        `Unsupported General Question type "${field.type}" for "${field.key}" — use one of: ${GENERAL_QUESTION_TYPES.join(', ')}.`
      );
    }
  }
}

/**
 * Load-time check that no Question Definition id can be mistaken for a
 * namespaced General Question key. The namespace only isolates the two if this
 * holds, and bank artifacts are hand-editable JSON — so it is enforced where
 * the catalogue is loaded rather than assumed in a comment.
 *
 * @param {QuestionDefinition[]} catalogue
 */
export function validateAnswerKeyNamespace(catalogue) {
  for (const question of catalogue) {
    if (question.id.includes(':')) {
      throw new Error(
        `Question Definition id "${question.id}" contains ":", which is reserved for namespaced answer keys such as "${GENERAL_ANSWER_PREFIX}<key>".`
      );
    }
  }
}
