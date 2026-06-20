// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { stressQuestions } from '../dev/fixtures/stress-questions.js';

/**
 * Stress-test Case Type — 500 generated questions.
 * Used by the hardening pass to verify render performance, debounce health,
 * and conditional-applicability scaling. Not a production Case Type.
 *
 * @type {CaseTypeConfig}
 */
const config = {
  eligibleGroups: ['Reviewers'],
  questions: stressQuestions,

  /** @param {Record<string, Answer>} answers */
  computeOutcome(answers) {
    const hasNo = Object.values(answers).some((a) => a.value === 'No');
    return { verdict: hasNo ? 'fail' : 'pass' };
  },
};

export default config;
