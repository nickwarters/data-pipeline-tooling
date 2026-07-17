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
 * `defaultOutcomeId` (view-model load, bank simulation); consumers then call
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
