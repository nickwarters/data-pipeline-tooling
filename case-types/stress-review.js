// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';
import { loadBank } from './load-bank.js';

const bank = await loadBank('./banks/stress-review.txt');

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
  // Demonstrative sectionLabels override (MAINT-11): renames the questions
  // tab *and* its section headings; every other Section keeps the defaults
  // from src/lib/section-labels.js. Distinct from `labels` above, which is
  // the reporting Label catalogue.
  sectionLabels: { questions: 'Assessment' },
  questions: bank.questions,
  // Outcome vocabulary: required even for this perf harness so the
  // Outcome block resolves wording from config rather than a built-in fallback.
  outcomeOptions: bank.outcomeOptions ?? [],
  // An absent bank field becomes an invalid load-time configuration, not a fallback.
  defaultOutcomeId: bank.defaultOutcomeId ?? '',

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
