// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */
/** @typedef {import('../src/question-bank/question-bank-source.js').QuestionBank} QuestionBank */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';
import bankJson from './banks/stress-review.json' with { type: 'json' };

const bank = /** @type {QuestionBank} */ (bankJson);

/**
 * Stress-test Case Type — 500 generated questions.
 * Used by the hardening pass to verify render performance, debounce health,
 * and conditional-applicability scaling. Not a production Case Type.
 *
 * @type {CaseTypeConfig}
 */
const config = {
  eligibleGroups: ['Reviewers'],
  labels: bank.labels,
  questions: bank.questions,
  // Outcome vocabulary: required even for this perf harness so the
  // Outcome block resolves wording from config rather than a built-in fallback.
  outcomeOptions: bank.outcomeOptions ?? [],
  defaultOutcomeId: bank.defaultOutcomeId,

  /** @param {Record<string, Answer>} answers */
  computeOutcome(answers) {
    return computeConfiguredOutcome(
      config.questions,
      answers,
      config.outcomeOptions,
      config.defaultOutcomeId
    );
  },
};

export default config;
