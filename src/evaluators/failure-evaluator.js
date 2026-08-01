// @ts-check
import { NA_VALUE } from '../lib/response-options.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * Derives the response values that count as failures for a question: every
 * option whose `optionOutcomes` entry maps to an Outcome other than the Case
 * Type's default. Unmapped options resolve to the default Outcome and so never
 * fail; the universal N/A is never a failure, even when a legacy bank maps it.
 *
 * @param {QuestionDefinition} question
 * @param {string} defaultOutcomeId
 * @returns {string[]}
 */
export function deriveFailureValues(question, defaultOutcomeId) {
  return Object.entries(question.optionOutcomes ?? {})
    .filter(
      ([value, outcomeId]) =>
        value !== NA_VALUE && outcomeId !== defaultOutcomeId
    )
    .map(([value]) => value);
}

/**
 * Annotates a catalogue with each question's derived `failureValues`. Called
 * wherever questions are materialised alongside their Case Type's
 * `defaultOutcomeId` (loader load, bank simulation); consumers then call
 * `isFailure(question, answer)` without needing the outcome configuration.
 * Questions that cannot fail are passed through untouched (any stale
 * annotation is stripped); the input array is never mutated.
 *
 * @param {QuestionDefinition[]} questions
 * @param {string} defaultOutcomeId
 * @returns {QuestionDefinition[]}
 */
export function withDerivedFailureValues(questions, defaultOutcomeId) {
  return questions.map((question) => {
    const failureValues = deriveFailureValues(question, defaultOutcomeId);
    if (failureValues.length) return { ...question, failureValues };
    if ('failureValues' in question) {
      const { failureValues: _drop, ...rest } = question;
      return rest;
    }
    return question;
  });
}

/**
 * Returns true if the Answer selects any of the question's derived
 * `failureValues` — i.e. any response mapping to a non-default Outcome.
 * For string[] values (multi-choice): true if any element matches. The
 * universal N/A never fails.
 *
 * @param {QuestionDefinition} question
 * @param {Answer | undefined} answer
 * @returns {boolean}
 */
export function isFailure(question, answer) {
  const failing = question.failureValues;
  if (!failing?.length || !answer) return false;
  const v = answer.value;
  const values = Array.isArray(v) ? v : [v];
  return values.some((value) => value !== NA_VALUE && failing.includes(value));
}

/**
 * Counts answers selecting a derived failure value. Questions with no
 * non-default outcome mapping are informational, even when answered with
 * values like "No".
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
 * Every Answer field that exists only because the Answer is a failure, and so
 * shares the failure's lifecycle: attribution, captured field values, the
 * Reviewer's remediation decision, whatever that decision produced, and the
 * resolution of it. Left behind on an Answer that has stopped failing, each would
 * be read as current the moment the Answer failed again — a re-failed Answer
 * would render pre-attributed and pre-resolved, and the completion gate would
 * count a decision nobody made this time round.
 *
 * @type {Array<keyof Answer>}
 */
const FAILURE_LIFETIME_KEYS = [
  'attributedParty',
  'capture',
  'remediationRequired',
  'freeFormRemediation',
  'remediationStatus',
  'remediationActions',
];

/**
 * Reconciles an Answer's failure-derived metadata with whether it is still a
 * failure. Configured remediation actions are available choices, not
 * selected choices, so a still-failing Answer keeps only the actions the
 * reviewer has selected onto the Answer. When the Answer is no longer a
 * failure, every field in `FAILURE_LIFETIME_KEYS` is stripped, so passing
 * answers never carry leftover failure metadata. A still-failing Answer keeps
 * all of them, even when the question defines no remediationActions.
 *
 * @param {QuestionDefinition} question
 * @param {Answer} answer
 * @returns {Answer}
 */
export function materializeRemediationActions(question, answer) {
  if (isFailure(question, answer)) return answer;

  /** @type {Answer} */
  let result = answer;
  for (const key of FAILURE_LIFETIME_KEYS) {
    if (result[key] === undefined) continue;
    const { [key]: _drop, ...rest } = result;
    result = /** @type {Answer} */ (rest);
  }
  return result;
}
