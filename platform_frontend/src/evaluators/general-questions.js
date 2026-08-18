// @ts-check
/**
 * General Questions: the answer-key namespace that keeps them out of every
 * catalogue-driven evaluator, the load-time checks that keep that promise true
 * rather than merely intended, and the one completion gate that does read them.
 *
 * The gate is not a hole in the namespace. Every evaluator that decides what a
 * Case *says* — applicability, failure, Question Group progress, the Outcome —
 * walks the catalogue and so cannot see a `general:` key. The gate walks the
 * Case Type's declared field list instead, and decides only *when* the Reviewer
 * may send: it changes no Answer, no progress count and no Outcome.
 */

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
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

/**
 * What a General Question currently holds, as text — `''` when unanswered.
 *
 * A General Question answer is a plain string, so anything else in the blob (an
 * array left by a multi-select Question Definition that once owned the key)
 * reads as unanswered. The Review tab renders through this same function, which
 * is what makes the gate below ask exactly the question the Reviewer sees: a
 * blank control is an unanswered question, whatever is underneath it.
 *
 * @param {Record<string, Answer>} answers
 * @param {string} fieldKey
 * @returns {string}
 */
export function generalAnswerText(answers, fieldKey) {
  const value = answers[generalAnswerKey(fieldKey)]?.value;
  return typeof value === 'string' ? value : '';
}

/**
 * Whether the Case still owes an answer to a General Question its Case Type
 * marked `required` — the pre-send half of the completion gate, alongside the
 * remediation decision, the required Issue Capture Fields and the Responsible
 * Party.
 *
 * Only `required` fields count: the shared catalogue carries deliberately
 * optional questions (`reviewerObservations`), and a Case Type that marks
 * nothing required is gated exactly as it was before this key existed.
 *
 * The section is safe to point a Reviewer at without checking access: the only
 * viewer who can reach this gate is the Assigned Reviewer before the Answers
 * freeze, and `questions` access is `edit` for exactly that pairing — so the
 * button is never disabled against a reason naming a section that is not on
 * the page.
 *
 * @param {GeneralQuestionField[] | undefined} fields
 * @param {Record<string, Answer>} answers
 * @returns {boolean}
 */
export function unfilledRequiredGeneralQuestion(fields, answers) {
  return (fields ?? []).some(
    (field) =>
      field.required === true && generalAnswerText(answers, field.key) === ''
  );
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
