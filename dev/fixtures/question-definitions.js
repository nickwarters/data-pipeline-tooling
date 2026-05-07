// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/**
 * Question Definitions for the hello-review Case Type.
 * q-resolve is conditional on q-needs being answered 'Yes'.
 *
 * @type {QuestionDefinition[]}
 */
export const questionDefinitions = [
  {
    id: 'q-welcome',
    text: 'Was the customer greeted professionally?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
  {
    id: 'q-needs',
    text: "Were the customer's needs identified before proceeding?",
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    remediationActions: ['Retrain agent on needs-identification protocol.'],
    deprecated: false,
  },
  {
    id: 'q-resolve',
    text: 'Was the issue resolved to the customer\'s satisfaction?',
    responseType: 'yes-no-na',
    showWhen: { 'q-needs': { equals: 'Yes' } },
    failureCriteria: 'No',
    remediationActions: ['Escalate unresolved case to senior agent.'],
    deprecated: false,
  },
];
