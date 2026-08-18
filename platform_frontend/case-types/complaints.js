// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';
import { loadBank } from './load-bank.js';
import { resolveGeneralQuestions } from './general-questions.js';

const bank = await loadBank('./banks/complaints.txt');

/**
 * The **Complaints** Case Type — a Complaints-style journey whose
 * appeals are raised by the **Journey Owner** and resolved by **Controls**. Its
 * per-Case-Type groups derive from the `Complaints` display name:
 * `Reviewers - Complaints`, `CaseTypeOwner - Complaints`,
 * `JourneyOwner - Complaints`.
 *
 * Declares its own `listName` (`Cases-Complaints`) like every other Case Type,
 * so its Cases are read/written list-scoped rather than from a default store.
 * Under `?mock=1`, `create-sharepoint-client.js` partitions the fixture Cases
 * into the matching per-list mock store, so Complaints Cases stay openable in
 * the dev loop.
 *
 * @type {CaseTypeConfig}
 */
const config = {
  listName: 'Cases-Complaints',
  // No `eligibleGroups`: `Reviewers - Complaints` is DERIVED from the registry
  // display name, and restating it here made it a second, independent
  // grant. Renaming the registry entry moved the three derived names but left
  // this copy still granting, so anyone left in the decommissioned SharePoint
  // group kept the access the rename was supposed to move. `eligibleGroups` is
  // for genuinely extra groups only.
  maxInProgressCases: 3,
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
  //
  // The Issues list can only subtract, so naming every role the Section is
  // already visible to changes nobody's Summary.
  sections: {
    details: { showInSummary: true },
    questions: { showInSummary: true },
    conversation: { allowMessagesWhen: ['Actions In Progress'] },
    notes: { showInSummary: false },
    issues: {
      showInSummary: [
        'assignedReviewer',
        'otherReviewer',
        'reviewerManager',
        'caseTypeOwner',
        'journeyOwner',
        'controls',
      ],
    },
    remediation: { showInSummary: true },
    summary: {},
    appealRequest: {},
    appealReview: {},
    amendOutcome: {},
  },
  // Every Question Group here is a homogeneous run of Outcome-scored Questions
  // about one part of the complaint, and a Reviewer who finds that part sound
  // clears the whole run at the same wording. So the Group Outcome is the ordinary way
  // to record that judgement rather than a per-group exception, and no group is
  // singled out to be answered a question at a time for no reason. Nothing is
  // locked — each Answer stays individually editable afterwards.
  allowBulkOutcome: true,
  // A remediation on a Complaint is either done or stood down. There is no
  // half-way state a Reviewer is asked to record here, so offering "Partially
  // complete" would only invite a resolution nobody reports on.
  remediationStatuses: ['complete', 'cancelled'],
  // Appeal flow: a Complaints journey routes appeal-raising to the Journey Owner.
  appeal: { raisedBy: 'journeyOwner' },
  // Outcome vocabulary. The Outcome is driven wholly by the responses
  // (question bank redesign): each mapped response option scores a configured
  // Outcome and the highest-scoring applicable Outcome wins from the required
  // configured default. Controls may still hand-set any of these via Amend Outcome.
  outcomeOptions: bank.outcomeOptions ?? [],
  labels: bank.labels,
  // An absent bank field becomes an invalid load-time configuration, not a fallback.
  defaultOutcomeId: bank.defaultOutcomeId ?? '',
  questions: bank.questions,

  // Issue Capture Groups — the typed fields a Reviewer captures against a
  // *failed* Answer on the Issues tab. Presentation-only groupings (see the
  // CaptureGroup typedef in sharepoint-client.js); field keys are unique across
  // all groups. `Customer impact` defaults collapsed to exercise the toggle.
  captureGroups: [
    {
      key: 'root-cause',
      label: 'Root cause & attribution',
      fields: [
        {
          key: 'rootCauseSummary',
          label: 'Root cause summary',
          type: 'textarea',
          placeholder: 'Describe what went wrong and why.',
        },
        {
          key: 'failureCategory',
          label: 'Failure category',
          type: 'select',
          options: ['Process', 'System', 'Human error', 'Third party'],
        },
        {
          key: 'attributedTo',
          label: 'Attributed to',
          type: 'person',
          // The semantic tag reporting will look for, so a cross-Case-Type
          // query finds who a failure was attributed to without knowing this
          // Case Type's field key.
          role: 'attributedParty',
        },
      ],
    },
    {
      key: 'customer-impact',
      label: 'Customer impact',
      collapsed: true,
      fields: [
        {
          key: 'harmLevel',
          label: 'Level of harm',
          type: 'radio',
          options: ['None', 'Minor', 'Material', 'Severe'],
        },
        {
          key: 'redressRequired',
          label: 'Redress required?',
          type: 'radio',
          options: ['Yes', 'No'],
        },
        {
          key: 'impactNotes',
          label: 'Impact notes',
          type: 'text',
          placeholder: 'Optional additional detail.',
        },
      ],
    },
  ],

  // General Questions — arbitrary fields a Reviewer answers below the Question
  // Groups on the Review tab. They use the Issue Capture Group field types but
  // are never outcome-driving: nothing here reaches computeOutcome,
  // applicability, failure evaluation or Question Group progress.
  //
  // Shared questions are included by key (see case-types/general-questions.js)
  // so the same question keeps one answer key across Case Types. A
  // Complaints-specific question would be written out inline in this same list.
  //
  // How the Case was reviewed is `required`: it holds Send Actions / Complete
  // Case until answered, because a Case reviewed on the file alone and one
  // reviewed against the call are not the same piece of evidence, and afterwards
  // nobody can tell which they are reading. Observations stay optional — it is
  // an invitation to say something, and insisting would only produce "n/a".
  generalQuestions: resolveGeneralQuestions([
    { key: 'reviewChannel', required: true },
    'reviewerObservations',
  ]),

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
