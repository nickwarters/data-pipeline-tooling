// @ts-check
// Test-only fixture Case Type. `example-review` was retired from the production
// manifest and the mock client in issue #383 (complaints is the only live Case
// Type), but its rich showWhen graph, capture groups and Outcome vocabulary
// remain the de-facto canonical fixture across the test suite. It lives under
// tests/ (not deployed, absent from case-types/manifest.js, not served by
// `?mock=1`) so nothing outside the tests carries it. Tests that need a
// manifest-shaped importer build one from this module.
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';
import { loadBank } from '../case-types/load-bank.js';

const bank = await loadBank(
  new URL('./_example-review-bank.txt', import.meta.url)
);

/** @type {CaseTypeConfig} */
const config = {
  displayName: 'Example Review',
  eligibleGroups: ['Reviewers'],
  listName: 'Cases-ExampleReview',
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
  outcomeOptions: bank.outcomeOptions ?? [],
  labels: bank.labels,
  // The Outcome is driven wholly by the responses (question bank redesign): each
  // mapped response option scores a configured Outcome and the highest-scoring
  // applicable Outcome wins from the required configured default.
  // An absent bank field becomes an invalid load-time configuration, not a fallback.
  defaultOutcomeId: bank.defaultOutcomeId ?? '',
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
  questions: bank.questions,

  // General Questions — non-outcome-driving fields rendered below the Question
  // Groups on the Review tab. Answers are namespaced (`general:<key>`) in the
  // same Answers blob and reach no evaluator.
  generalQuestions: [
    {
      key: 'reviewChannel',
      label: 'How was this reviewed?',
      type: 'select',
      options: ['Case file only', 'Call recording'],
    },
    { key: 'observations', label: 'Observations', type: 'textarea' },
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
