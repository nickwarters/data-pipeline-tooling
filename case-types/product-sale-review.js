// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { countConfiguredFailures } from '../src/evaluators/failure-evaluator.js';

/** @type {CaseTypeConfig} */
const config = {
  listName: 'complaints',
  eligibleGroups: ['Reviewers'],
  attributeFailures: true,
  questions: [
    // Customer Verification
    {
      id: 'q-cv-identity',
      text: "Was the customer's identity verified before proceeding?",
      category: 'Customer Verification',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      remediationActions: [
        'Re-verify customer identity using an approved verification method before continuing.',
      ],
      deprecated: false,
    },
    {
      id: 'q-cv-method',
      text: 'Which verification method was used?',
      category: 'Customer Verification',
      responseType: 'single-choice',
      options: ['Knowledge-based', 'Document', 'Biometric'],
      deprecated: false,
    },
    {
      id: 'q-cv-repeat',
      text: 'Was this a repeat contact requiring escalation?',
      category: 'Customer Verification',
      responseType: 'yes-no-na',
      deprecated: false,
    },
    // Product Suitability
    {
      id: 'q-ps-needs',
      text: "Were the customer's financial needs assessed before making a recommendation?",
      category: 'Product Suitability',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      remediationActions: [
        'Complete a full needs assessment before recommending any product.',
      ],
      deprecated: false,
    },
    {
      id: 'q-ps-product',
      text: 'Which product was recommended?',
      category: 'Product Suitability',
      responseType: 'single-choice',
      options: ['Basic', 'Standard', 'Premium'],
      deprecated: false,
    },
    {
      id: 'q-ps-suitable',
      text: "Was the recommended product suitable for the customer's stated needs?",
      category: 'Product Suitability',
      responseType: 'yes-no-na',
      showWhen: { 'q-ps-needs': { equals: 'Yes' } },
      failureCriteria: 'No',
      remediationActions: [
        'Review suitability criteria and document why the selected product meets customer needs.',
      ],
      deprecated: false,
    },
    {
      id: 'q-ps-documented',
      text: 'Was the recommendation and its rationale documented in the case notes?',
      category: 'Product Suitability',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
    // Compliance
    {
      id: 'q-co-disclosure',
      text: 'Were all required product disclosures made to the customer?',
      category: 'Compliance',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      remediationActions: [
        'Deliver missing disclosures and record customer acknowledgement.',
      ],
      deprecated: false,
    },
    {
      id: 'q-co-consent',
      text: 'Was customer consent recorded prior to processing the sale?',
      category: 'Compliance',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
    {
      id: 'q-co-channel',
      text: 'Which sales channel was used?',
      category: 'Compliance',
      responseType: 'single-choice',
      options: ['Branch', 'Phone', 'Online', 'Broker'],
      deprecated: false,
    },
  ],

  // Outcome vocabulary (ADR-0004). `computeOutcome` yields pass/refer/fail by
  // failure count; the wording shown to Reviewers is resolved from here.
  outcomeOptions: [
    { id: 'pass', wording: 'Pass' },
    { id: 'refer', wording: 'Refer' },
    { id: 'fail', wording: 'Fail' },
  ],

  /** @param {Record<string, Answer>} answers */
  computeOutcome(answers) {
    const failures = countConfiguredFailures(config.questions, answers);
    if (failures === 0) return { outcome: 'pass' };
    if (failures === 1) return { outcome: 'refer' };
    return { outcome: 'fail' };
  },
};

export default config;
