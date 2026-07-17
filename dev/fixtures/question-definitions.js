// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * Question Definitions for the example-review Case Type.
 * q-resolve is conditional on q-needs being answered 'Yes'.
 *
 * @type {QuestionDefinition[]}
 */
export const questionDefinitions = [
  {
    id: 'q-welcome',
    text: 'Was the customer greeted professionally?',
    questionGroup: 'Opening',
    responseType: 'yes-no-na',
    optionOutcomes: { No: 'fail' },
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: "Were the customer's needs identified before proceeding?",
    questionGroup: 'Discovery',
    responseType: 'yes-no-na',
    optionOutcomes: { No: 'fail' },
    remediationActions: ['Retrain agent on needs-identification protocol.'],
    deprecated: false,
  },
  {
    id: 'q-resolve',
    text: "Was the issue resolved to the customer's satisfaction?",
    questionGroup: 'Resolution',
    responseType: 'yes-no-na',
    showWhen: { 'q-needs': { equals: 'Yes' } },
    optionOutcomes: { No: 'fail' },
    remediationActions: ['Escalate unresolved case to senior agent.'],
    deprecated: false,
  },
  {
    id: 'q-channel',
    text: 'Which channel was the customer using?',
    responseType: 'single-choice',
    options: ['Phone', 'Email', 'Chat'],
    deprecated: false,
  },
  {
    id: 'q-products',
    text: 'Which products were discussed during the interaction?',
    responseType: 'multi-choice',
    options: ['Account', 'Billing', 'Support'],
    deprecated: false,
  },
];
