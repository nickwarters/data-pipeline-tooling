// @ts-check
// TODO(simplify-ui): Keep case-type configuration as plain data for the
// function-component UI. Screens should consume these definitions through
// explicit props/signals, without custom-element lifecycle or controller wiring
// leaking into configuration modules.

/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { stressQuestions } from '../dev/fixtures/stress-questions.js';
import { countConfiguredFailures } from '../src/evaluators/failure-evaluator.js';

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
    const failures = countConfiguredFailures(config.questions, answers);
    return { outcome: failures > 0 ? 'fail' : 'pass' };
  },
};

export default config;
