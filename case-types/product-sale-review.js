// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */
/** @typedef {import('../src/question-bank/question-bank-source.js').QuestionBank} QuestionBank */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';
import bankJson from './banks/product-sale-review.json' with { type: 'json' };

const bank = /** @type {QuestionBank} */ (bankJson);

/** @type {CaseTypeConfig} */
const config = {
  listName: 'complaints',
  eligibleGroups: ['Reviewers'],
  attributeFailures: true,
  labels: bank.labels,
  questions: bank.questions,

  // Outcome vocabulary. The Outcome is driven wholly by the responses
  // (question bank redesign): each mapped response option scores a configured
  // Outcome and the highest-scoring applicable Outcome wins, defaulting to `pass`.
  // `severity` orders the outcomes (higher = worse).
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
