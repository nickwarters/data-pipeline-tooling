// @ts-check
import { loadBank } from './load-bank.js';

/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */

const bank = await loadBank('./banks/complaints.txt');

export const complaintsData = Object.freeze(
  /** @type {Omit<CaseTypeConfig, 'computeOutcome'> & {slug:string,version?:string}} */ ({
    slug: 'complaints',
    listName: 'Cases-Complaints',
    maxInProgressCases: 3,
    detailFields: [
      { key: 'complaintRef', label: 'Complaint reference' },
      { key: 'customerName', label: 'Customer name' },
      { key: 'complaintDate', label: 'Complaint date' },
    ],
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
    allowBulkOutcome: true,
    remediationStatuses: ['complete', 'cancelled'],
    appeal: { raisedBy: 'journeyOwner' },
    outcomeOptions: bank.outcomeOptions ?? [],
    labels: bank.labels,
    defaultOutcomeId: bank.defaultOutcomeId ?? '',
    questions: bank.questions,
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
    generalQuestions: [
      {
        key: 'reviewChannel',
        label: 'How was this Case reviewed?',
        type: 'select',
        options: ['Case file only', 'Call recording', 'Both'],
      },
      {
        key: 'reviewerObservations',
        label: 'Observations for the Case Type Owner',
        type: 'textarea',
        placeholder: 'Optional — anything worth feeding back on the journey.',
      },
    ],
    version: /** @type {any} */ (bank).version,
  })
);

export default complaintsData;
