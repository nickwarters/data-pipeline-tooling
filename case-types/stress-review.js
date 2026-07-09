// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { stressQuestions } from '../dev/fixtures/stress-questions.js';
import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';

/**
 * Stress-test Case Type — 500 generated questions.
 * Used by the hardening pass to verify render performance, debounce health,
 * and conditional-applicability scaling. Not a production Case Type.
 *
 * @type {CaseTypeConfig}
 */
const config = {
  eligibleGroups: ['Reviewers'],
  labels: [
    { id: 'lbl-performance', name: 'Performance', color: '#0f766e' },
    { id: 'lbl-conditional', name: 'Conditional logic', color: '#7c3aed' },
  ],
  questions: stressQuestions.map((question) => ({
    ...question,
    labelIds: question.showWhen ? ['lbl-conditional'] : ['lbl-performance'],
  })),
  // Outcome vocabulary: required even for this perf harness so the
  // Outcome block resolves wording from config rather than a built-in fallback.
  outcomeOptions: [
    { id: 'pass', wording: 'Pass', severity: 0 },
    { id: 'fail', wording: 'Fail', severity: 100 },
  ],
  defaultOutcomeId: 'pass',

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
