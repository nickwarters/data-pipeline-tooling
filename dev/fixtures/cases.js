// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */

/**
 * Three hello-review Cases:
 *   case-1 — untouched (no Answers)
 *   case-2 — partially answered (q-welcome answered, q-needs not answered)
 *   case-3 — completable (q-welcome + q-needs answered; q-resolve not applicable because q-needs ≠ Yes)
 *
 * @type {CaseRow[]}
 */
export const cases = [
  {
    id: 'case-1',
    caseType: 'hello-review',
    title: 'Hello Review #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'etag-c1-v1',
  },
  {
    id: 'case-2',
    caseType: 'hello-review',
    title: 'Hello Review #2',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    answers: {
      'q-welcome': { value: 'Yes' },
    },
    conversation: [
      { author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Please confirm the greeting script used.' },
      { author: 'user-agent-b', timestamp: '2026-05-07T09:15:00Z', body: 'Standard greeting was used per policy.' },
    ],
    notes: '',
    completedAt: null,
    etag: 'etag-c2-v1',
  },
  {
    id: 'case-3',
    caseType: 'hello-review',
    title: 'Hello Review #3',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-c',
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'No', justification: 'Agent jumped straight to resolution without confirming the issue.' },
      'q-channel': { value: 'Phone' },
      'q-products': { value: ['Billing'] },
    },
    conversation: [],
    notes: 'All applicable questions answered — ready to complete.',
    completedAt: null,
    etag: 'etag-c3-v1',
  },
];
