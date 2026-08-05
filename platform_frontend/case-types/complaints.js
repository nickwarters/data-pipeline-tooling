// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';
import complaintsData from './complaints-data.js';
import { resolveGeneralQuestions } from './general-questions.js';

/** @type {CaseTypeConfig} */
const config = {
  ...complaintsData,
  generalQuestions: resolveGeneralQuestions(complaintsData.generalQuestions),
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
