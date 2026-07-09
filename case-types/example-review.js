// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';

/** @type {CaseTypeConfig} */
const config = {
  eligibleGroups: ['Reviewers'],
  slaHours: 48,
  attributeFailures: true,
  // Case Type-specific Case Details fields. Values live
  // in the CaseRow.details JSON blob keyed by `key`; the Case Details and
  // Summary Sections render them read-only after the common Case-row fields.
  detailFields: [
    { key: 'customerName', label: 'Customer name' },
    { key: 'accountNumber', label: 'Account number' },
    { key: 'interactionDate', label: 'Interaction date' },
  ],
  // Per-Section config object: membership is the allow-list, and
  // showInSummary controls each Section's block in the read-only Summary. Notes
  // is deliberately excluded from Summary (Case Justification + general note).
  sections: {
    details: { showInSummary: true },
    questions: { showInSummary: true },
    conversation: { allowMessagesWhen: ['Actions In Progress'] },
    notes: { showInSummary: false },
    issues: { showInSummary: true },
    remediation: { showInSummary: true },
    summary: {},
    appealRequest: {},
    appealReview: {},
    amendOutcome: {},
  },
  // Appeal flow: this journey routes appeal-raising to the Journey
  // Owner, resolved by Controls.
  appeal: { raisedBy: 'journeyOwner', resolvedBy: 'controls' },
  // Outcome vocabulary. `computeOutcome` only yields pass/fail, but the
  // hand-set Amend Outcome verdict lets Controls also pick `refer`, so
  // the full set of selectable Outcomes is declared here.
  outcomeOptions: [
    { id: 'pass', wording: 'Pass', severity: 0 },
    { id: 'refer', wording: 'Refer', severity: 50 },
    { id: 'fail', wording: 'Fail', severity: 100 },
  ],
  // The Outcome is driven wholly by the responses (question bank redesign): each
  // mapped response option scores a configured Outcome and the highest-scoring
  // applicable Outcome wins, defaulting to `pass`.
  defaultOutcomeId: 'pass',
  // Configurable per-failure capture fields. One shared set applies
  // to every failed Answer; captured inline as Answer.remediationDetails. Legacy:
  // superseded by captureGroups below but kept while both coexist.
  remediationFields: [
    { key: 'rootCause', label: 'Root cause', type: 'text', required: true },
    {
      key: 'severity',
      label: 'Severity',
      type: 'select',
      options: ['Low', 'Med', 'High'],
    },
  ],
  // Unified Issue Capture engine: everything captured against a failed
  // Answer, as ordered, collapsible groups of typed fields. This slice exercises
  // the four string field types; person/actions arrive in their own slices.
  captureGroups: [
    {
      key: 'cause',
      label: 'Cause',
      collapsed: false,
      fields: [
        { key: 'rootCause', label: 'Root cause', type: 'text', required: true },
        { key: 'whatHappened', label: 'What happened', type: 'textarea' },
        {
          key: 'contributingFactors',
          label: 'Contributing factors',
          type: 'textarea',
        },
      ],
    },
    {
      key: 'grading',
      label: 'Grading',
      collapsed: true,
      fields: [
        {
          key: 'severity',
          label: 'Severity',
          type: 'select',
          options: ['Low', 'Med', 'High'],
        },
        {
          key: 'priority',
          label: 'Priority',
          type: 'select',
          options: ['P1', 'P2', 'P3'],
        },
        {
          key: 'repeatIssue',
          label: 'Repeat issue?',
          type: 'select',
          options: ['Yes', 'No'],
        },
      ],
    },
    {
      key: 'impact',
      label: 'Impact',
      collapsed: true,
      fields: [
        {
          key: 'customerImpact',
          label: 'Impact on the customer',
          type: 'textarea',
        },
        {
          key: 'impactArea',
          label: 'Impact area',
          type: 'select',
          options: ['Financial', 'Operational', 'Reputational', 'None'],
        },
        {
          key: 'regulatoryBreach',
          label: 'Regulatory breach?',
          type: 'select',
          options: ['Yes', 'No'],
        },
      ],
    },
    {
      key: 'resolution',
      label: 'Resolution',
      collapsed: true,
      fields: [
        {
          key: 'correctiveAction',
          label: 'Corrective action taken',
          type: 'textarea',
        },
        {
          key: 'preventiveAction',
          label: 'Preventive action',
          type: 'textarea',
        },
        { key: 'actionOwner', label: 'Action owner', type: 'text' },
        {
          key: 'followUpRequired',
          label: 'Follow-up required?',
          type: 'select',
          options: ['Yes', 'No'],
        },
      ],
    },
  ],
  questions: [
    {
      id: 'q-welcome',
      text: 'Was the customer greeted professionally?',
      category: 'Opening',
      responseType: 'yes-no-na',
      optionOutcomes: { No: 'fail' },
      failureCriteria: 'No',
      deprecated: false,
    },
    {
      id: 'q-needs',
      text: "Were the customer's needs identified before proceeding?",
      category: 'Discovery',
      responseType: 'yes-no-na',
      optionOutcomes: { No: 'fail' },
      failureCriteria: 'No',
      remediationActions: ['Retrain agent on needs-identification protocol.'],
      deprecated: false,
    },
    {
      id: 'q-resolve',
      text: "Was the issue resolved to the customer's satisfaction?",
      category: 'Resolution',
      responseType: 'yes-no-na',
      showWhen: { 'q-needs': { equals: 'Yes' } },
      optionOutcomes: { No: 'fail' },
      failureCriteria: 'No',
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
  ],

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
