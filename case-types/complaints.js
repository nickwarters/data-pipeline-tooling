// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';
import { loadBank } from './load-bank.js';

const bank = await loadBank('./banks/complaints.txt');

/**
 * The **Complaints** Case Type — a Complaints-style journey whose
 * appeals are raised by the **Journey Owner** and resolved by **Controls**. Its
 * per-Case-Type groups derive from the `Complaints` display name:
 * `Reviewers - Complaints`, `CaseTypeOwner - Complaints`,
 * `JourneyOwner - Complaints`.
 *
 * NOTE (dev/mock): deliberately declares **no `listName`**, so its Cases live in
 * the default mock store and are openable via `?mock=1`. A production Complaints
 * list can be added once list-backed Case Types are wired into the mock client
 *; until then a `listName` here would 404 every Complaints Case in
 * the mock dev loop.
 *
 * @type {CaseTypeConfig}
 */
const config = {
  displayName: 'Complaints',
  eligibleGroups: ['Reviewers - Complaints'],
  slaHours: 72,
  attributeFailures: true,
  // Case Type-specific Case Details fields. Values live in the
  // CaseRow.details JSON blob keyed by `key`.
  detailFields: [
    { key: 'complaintRef', label: 'Complaint reference' },
    { key: 'customerName', label: 'Customer name' },
    { key: 'complaintDate', label: 'Complaint date' },
  ],
  // Per-Section config object. Mirrors the amended Section set: the
  // block Sections opt in/out of the Summary, and the appeal/amend Sections are
  // enabled so the Complaints appeal flow and Amend Outcome
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
  // Appeal flow: a Complaints journey routes appeal-raising to the
  // Journey Owner, resolved by Controls.
  appeal: { raisedBy: 'journeyOwner', resolvedBy: 'controls' },
  // Outcome vocabulary. The Outcome is driven wholly by the responses
  // (question bank redesign): each mapped response option scores a configured
  // Outcome and the highest-scoring applicable Outcome wins from the required
  // configured default. Controls may still hand-set any of these via Amend Outcome.
  outcomeOptions: bank.outcomeOptions ?? [],
  labels: bank.labels,
  // An absent bank field becomes an invalid load-time configuration, not a fallback.
  defaultOutcomeId: bank.defaultOutcomeId ?? '',
  questions: bank.questions,

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
