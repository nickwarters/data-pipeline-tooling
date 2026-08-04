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
 * `CaptureField` vocabulary on purpose: a General Question answer is a plain
 * string stored under its namespaced key, and both the Review tab and the
 * Summary roll-up format it as text. A people picker also needs per-field
 * debounced search state, which the Review tab carries nowhere. A Case Type
 * Owner is told that at load time rather than shipping a field that cannot work.
 */
export const GENERAL_QUESTION_TYPES = ['text', 'textarea', 'select', 'radio'];

/**
 * @param {string} fieldKey
 * @returns {string}
 */
export function generalAnswerKey(fieldKey) {
  return `${GENERAL_ANSWER_PREFIX}${fieldKey}`;
}

/** @typedef {'before' | 'after'} GeneralQuestionsPlacement */

/**
 * Resolve where a Case Type's General Questions sit relative to its Question
 * Groups. The single interpreter of `config.generalQuestionsPlacement` — the
 * Review tab and the Summary roll-up must not read the raw config value, which
 * is how the two used to normalise it differently.
 *
 * Anything other than `'before'` resolves to `'after'`, including `undefined`:
 * the default is after, and an invalid value must not produce a third layout.
 * The coercion is deliberate and silent — a Case Type with a typo'd placement
 * renders beneath the Question Groups rather than failing to load. If a third
 * legal placement is ever added, `validateGeneralQuestions()` is where a loud
 * load-time rejection would belong.
 *
 * @param {Pick<import('../sharepoint-client.js').CaseTypeConfig, 'generalQuestionsPlacement'> | null | undefined} config
 * @returns {GeneralQuestionsPlacement}
 */
export function resolveGeneralQuestionsPlacement(config) {
  return config?.generalQuestionsPlacement === 'before' ? 'before' : 'after';
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
