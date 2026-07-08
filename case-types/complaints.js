// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';

/**
 * The **Complaints** Case Type — a Complaints-style journey (ADR-0027) whose
 * appeals are raised by the **Journey Owner** and resolved by **Controls**. Its
 * per-Case-Type groups derive from the `Complaints` display name (ADR-0022):
 * `Reviewers - Complaints`, `CaseTypeOwner - Complaints`,
 * `JourneyOwner - Complaints`.
 *
 * NOTE (dev/mock): deliberately declares **no `listName`**, so its Cases live in
 * the default mock store and are openable via `?mock=1`. A production Complaints
 * list can be added once list-backed Case Types are wired into the mock client
 * (issue #249); until then a `listName` here would 404 every Complaints Case in
 * the mock dev loop.
 *
 * @type {CaseTypeConfig}
 */
const config = {
  eligibleGroups: ['Reviewers'],
  slaHours: 72,
  attributeFailures: true,
  // Case Type-specific Case Details fields (ADR-0014). Values live in the
  // CaseRow.details JSON blob keyed by `key`.
  detailFields: [
    { key: 'complaintRef', label: 'Complaint reference' },
    { key: 'customerName', label: 'Customer name' },
    { key: 'complaintDate', label: 'Complaint date' },
  ],
  // Per-Section config object (ADR-0016). Mirrors the amended Section set: the
  // block Sections opt in/out of the Summary, and the appeal/amend Sections are
  // enabled so the Complaints appeal flow (ADR-0027) and Amend Outcome (ADR-0026)
  // are available.
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
  // Appeal flow (ADR-0027): a Complaints journey routes appeal-raising to the
  // Journey Owner, resolved by Controls.
  appeal: { raisedBy: 'journeyOwner', resolvedBy: 'controls' },
  // Outcome vocabulary (ADR-0004). The Outcome is driven wholly by the responses
  // (question bank redesign): each mapped response option scores a configured
  // Outcome and the highest-scoring applicable Outcome wins, defaulting to
  // `pass`. Controls may still hand-set any of these via Amend Outcome (ADR-0026).
  outcomeOptions: [
    { id: 'pass', wording: 'Pass', severity: 0 },
    { id: 'refer', wording: 'Refer', severity: 50 },
    { id: 'fail', wording: 'Fail', severity: 100 },
  ],
  defaultOutcomeId: 'pass',
  questions: [
    {
      id: 'q-cm-ack',
      text: 'Was the complaint acknowledged within the required timeframe?',
      category: 'Acknowledgement',
      responseType: 'yes-no-na',
      optionOutcomes: { No: 'fail' },
      failureCriteria: 'No',
      remediationActions: [
        'Acknowledge the complaint in writing within the regulatory timeframe.',
      ],
      deprecated: false,
    },
    {
      id: 'q-cm-investigated',
      text: 'Was the complaint fully investigated?',
      category: 'Investigation',
      responseType: 'yes-no-na',
      optionOutcomes: { No: 'fail' },
      failureCriteria: 'No',
      remediationActions: [
        'Complete a full investigation covering every point the customer raised.',
      ],
      deprecated: false,
    },
    {
      id: 'q-cm-root-cause',
      text: 'Was the root cause of the complaint identified?',
      category: 'Investigation',
      responseType: 'yes-no-na',
      showWhen: { 'q-cm-investigated': { equals: 'Yes' } },
      optionOutcomes: { No: 'refer' },
      failureCriteria: 'No',
      deprecated: false,
    },
    {
      id: 'q-cm-channel',
      text: 'How was the complaint received?',
      category: 'Resolution',
      responseType: 'single-choice',
      options: ['Phone', 'Email', 'Letter', 'In branch'],
      deprecated: false,
    },
    {
      id: 'q-cm-redress',
      text: 'Where the complaint was upheld, was appropriate redress offered?',
      category: 'Resolution',
      responseType: 'yes-no-na',
      optionOutcomes: { No: 'refer' },
      failureCriteria: 'No',
      remediationActions: [
        'Recalculate and offer appropriate redress to the customer.',
      ],
      deprecated: false,
    },
    {
      id: 'q-cm-final-response',
      text: 'Was a final response issued to the customer?',
      category: 'Communication',
      responseType: 'yes-no-na',
      optionOutcomes: { No: 'refer' },
      failureCriteria: 'No',
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
