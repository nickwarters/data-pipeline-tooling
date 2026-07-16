// @ts-check
/**
 * The single source of truth for Reviewer response options and the universal
 * N/A option (#390 Part 2, #391).
 *
 * `NA_VALUE` is the canonical stored literal for an N/A Answer. It is `'NA'`
 * (not `'N/A'`) because that is what existing Answers already store —
 * changing it would need a data migration. Every producer and consumer of the
 * N/A value must import it from here; #391 happened because the literal was
 * duplicated and drifted.
 *
 * N/A is inert by default: it appears in no `optionOutcomes` mapping (the
 * bank editor never offers one), so `computeConfiguredOutcome` skips it, and
 * `isFailure` only matches it when an author deliberately configures
 * `failureCriteria: 'NA'`.
 */

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */

export const NA_VALUE = 'NA';

/**
 * The fixed options of a `yes-no-na` question. N/A is *not* baked in — it
 * arrives via the universal mechanism (`reviewerResponseOptions`) like every
 * other response type, so there is exactly one N/A code path.
 */
export const YES_NO = ['Yes', 'No'];

/**
 * The authorable response options of a question — what the bank editor shows
 * and maps to Outcomes. Excludes the universal N/A.
 *
 * @param {Pick<QuestionDefinition, 'responseType' | 'options'>} question
 * @returns {string[]}
 */
export function baseResponseOptions(question) {
  return question.responseType === 'yes-no-na'
    ? YES_NO
    : (question.options ?? []);
}

/**
 * The options offered to the Reviewer: the question's own options plus the
 * universal N/A, on every response type.
 *
 * @param {Pick<QuestionDefinition, 'responseType' | 'options'>} question
 * @returns {string[]}
 */
export function reviewerResponseOptions(question) {
  const base = baseResponseOptions(question);
  return base.includes(NA_VALUE) ? base : [...base, NA_VALUE];
}
