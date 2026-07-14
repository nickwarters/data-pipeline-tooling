// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';
import { loadBank } from './load-bank.js';

const bank = await loadBank('./banks/product-sale-review.txt');

/** @type {CaseTypeConfig} */
const config = {
  displayName: 'Product Sale Review',
  listName: 'complaints',
  eligibleGroups: ['Reviewers - Product Sale Review'],
  attributeFailures: true,
  labels: bank.labels,
  questions: bank.questions,

  // Demonstrates a Case-Type-contributed dashboard column (MAINT-12): shown by
  // Team Cases only when the table is filtered to this single Case Type — see
  // the `dashboardColumns` JSDoc on `CaseTypeConfig` for the mixed-Case-Type
  // semantics.
  dashboardColumns: [
    {
      key: 'responsibleParty',
      label: 'Responsible Party',
      sortable: true,
      getValue: (/** @type {CaseRow} */ r) => r.responsibleParty,
    },
  ],

  // Outcome vocabulary. The Outcome is driven wholly by the responses
  // (question bank redesign): each mapped response option scores a configured
  // Outcome and the highest-scoring applicable Outcome wins from the required
  // configured default.
  // `severity` orders the outcomes (higher = worse).
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
