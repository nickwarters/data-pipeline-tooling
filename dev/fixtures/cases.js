// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */

const _now = new Date();
const _todayStart = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate());
const _threeDaysAgo = new Date(_todayStart.getTime() - 3 * 24 * 60 * 60 * 1000);
const _twoMonthsAgo = new Date(_todayStart);
_twoMonthsAgo.setMonth(_twoMonthsAgo.getMonth() - 2);
const _yesterday = new Date(_todayStart.getTime() - 24 * 60 * 60 * 1000);
const _nextWeek = new Date(_todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);

// Reviewer Manager report: cases assigned to user-rm (morgan manager)
const _fiveDaysAgo = new Date(_todayStart.getTime() - 5 * 24 * 60 * 60 * 1000);
const _twentyDaysAgo = new Date(_todayStart.getTime() - 20 * 24 * 60 * 60 * 1000);

/**
 * hello-review Cases:
 *   case-1  — untouched (no Answers, assigned)
 *   case-2  — partially answered (assigned)
 *   case-3  — completable (assigned)
 *   case-4  — In-progress, unassigned (oldest; for allocation + owner outstanding count)
 *   case-5  — Completed today (for owner completedToday count)
 *   case-6  — Completed 3 days ago (for owner completedLast7Days count)
 *   case-7  — In-progress, unassigned (newer than case-4; for allocation 412-retry test)
 *   case-8  — Completed today, responsibleParty=user-rp
 *   case-9  — Completed 2 months ago, responsibleParty=user-rp
 *   case-10 — In-progress, OVERDUE (dueDate=yesterday), responsibleParty=user-rp
 *
 * Reviewer Manager (user-rm) report cases:
 *   rm-case-1 — Completed 5 days ago (in 7-day tile)
 *   rm-case-2 — Completed 20 days ago (in 30-day tile only)
 *   rm-case-3 — In-progress, due next week (outstanding)
 *   rm-case-4 — In-progress, OVERDUE (dueDate=yesterday)
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
    created: '2026-05-01T08:00:00Z',
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
    created: '2026-05-02T08:00:00Z',
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
      'q-needs': {
        value: 'No',
        justification: 'Agent jumped straight to resolution without confirming the issue.',
        attributedParty: { loginName: 'agent.c', displayName: 'Agent C (Casey Doyle)' },
      },
      'q-channel': { value: 'Phone' },
      'q-products': { value: ['Billing'] },
    },
    conversation: [],
    notes: 'All applicable questions answered — ready to complete.',
    completedAt: null,
    created: '2026-05-03T08:00:00Z',
    etag: 'etag-c3-v1',
  },
  {
    id: 'case-4',
    caseType: 'hello-review',
    title: 'Hello Review #4',
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: 'user-agent-d',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    created: '2026-05-04T08:00:00Z',
    etag: 'etag-c4-v1',
  },
  {
    id: 'case-5',
    caseType: 'hello-review',
    title: 'Hello Review #5',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-e',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: _todayStart.toISOString(),
    created: '2026-05-05T08:00:00Z',
    etag: 'etag-c5-v1',
  },
  {
    id: 'case-6',
    caseType: 'hello-review',
    title: 'Hello Review #6',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-f',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: _threeDaysAgo.toISOString(),
    created: '2026-05-06T08:00:00Z',
    etag: 'etag-c6-v1',
  },
  {
    id: 'case-7',
    caseType: 'hello-review',
    title: 'Hello Review #7',
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: 'user-agent-g',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    created: '2026-05-07T08:00:00Z',
    etag: 'etag-c7-v1',
  },
  // --- Responsible Party portal fixture cases (responsibleParty: 'user-rp') ---
  {
    id: 'case-8',
    caseType: 'hello-review',
    title: 'Hello Review #8',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: _todayStart.toISOString(),
    outcome: 'Pass',
    created: '2026-04-28T08:00:00Z',
    etag: 'etag-c8-v1',
  },
  {
    id: 'case-9',
    caseType: 'hello-review',
    title: 'Hello Review #9',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: _twoMonthsAgo.toISOString(),
    outcome: 'Fail',
    created: '2026-03-01T08:00:00Z',
    etag: 'etag-c9-v1',
  },
  {
    id: 'case-10',
    caseType: 'hello-review',
    title: 'Hello Review #10',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {
      'q-needs': {
        value: 'No',
        justification: 'Needs improvement',
        remediationActions: [
          { id: 'ra-10-1', text: 'Ensure agent identifies customer needs before proceeding', completed: false },
        ],
      },
    },
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _yesterday.toISOString(),
    created: '2026-05-01T08:00:00Z',
    etag: 'etag-c10-v1',
  },
  {
    id: 'case-11',
    caseType: 'hello-review',
    title: 'Hello Review #11',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {
      'q-welcome': {
        value: 'No',
        remediationActions: [
          { id: 'ra-11-1', text: 'Review greeting standards and apply correct opening', completed: false },
        ],
      },
    },
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    created: '2026-05-02T08:00:00Z',
    etag: 'etag-c11-v1',
  },
  {
    id: 'case-12',
    caseType: 'hello-review',
    title: 'Hello Review #12',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [
      { author: 'user-reviewer', timestamp: '2026-05-07T09:00:00Z', body: 'Please clarify the greeting used.' },
      { author: 'user-rp', timestamp: '2026-05-07T09:30:00Z', body: 'Standard greeting was used.' },
      { author: 'user-reviewer', timestamp: '2026-05-07T10:00:00Z', body: 'Can you provide the exact wording?' },
    ],
    notes: '',
    completedAt: null,
    created: '2026-05-03T08:00:00Z',
    etag: 'etag-c12-v1',
  },
  {
    id: 'case-13',
    caseType: 'hello-review',
    title: 'Hello Review #13',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [
      { author: 'user-reviewer', timestamp: '2026-05-08T09:00:00Z', body: 'Please respond to review queries.' },
    ],
    notes: '',
    completedAt: null,
    created: '2026-05-04T08:00:00Z',
    etag: 'etag-c13-v1',
  },
  // --- Reviewer Manager (user-rm) report fixture cases ---
  {
    id: 'rm-case-1',
    caseType: 'hello-review',
    title: 'Hello Review #RM-1',
    status: 'Completed',
    assignedReviewer: 'user-reviewer-2',
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-agent-a',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: _fiveDaysAgo.toISOString(),
    created: '2026-05-01T08:00:00Z',
    etag: 'etag-rm1-v1',
  },
  {
    id: 'rm-case-2',
    caseType: 'hello-review',
    title: 'Hello Review #RM-2',
    status: 'Completed',
    assignedReviewer: 'user-reviewer-2',
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-agent-b',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: _twentyDaysAgo.toISOString(),
    created: '2026-04-20T08:00:00Z',
    etag: 'etag-rm2-v1',
  },
  {
    id: 'rm-case-3',
    caseType: 'hello-review',
    title: 'Hello Review #RM-3',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer-2',
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-agent-c',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    created: '2026-05-10T08:00:00Z',
    etag: 'etag-rm3-v1',
  },
  {
    id: 'rm-case-4',
    caseType: 'hello-review',
    title: 'Hello Review #RM-4',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer-2',
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-agent-d',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _yesterday.toISOString(),
    created: '2026-05-05T08:00:00Z',
    etag: 'etag-rm4-v1',
  },
  // --- product-sale-review fixture cases ---
  {
    id: 'psr-case-1',
    caseType: 'product-sale-review',
    title: 'Product Sale Review #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    created: '2026-05-10T08:00:00Z',
    etag: 'etag-psr1-v1',
  },
  {
    id: 'psr-case-2',
    caseType: 'product-sale-review',
    title: 'Product Sale Review #2',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    answers: {
      'q-cv-identity': { value: 'Yes' },
      'q-cv-method': { value: 'Knowledge-based' },
      'q-ps-needs': { value: 'No', justification: 'Agent proceeded directly to recommendation without assessing needs.' },
    },
    conversation: [
      { author: 'user-reviewer', timestamp: '2026-05-11T09:00:00Z', body: 'Please clarify why needs assessment was skipped.' },
    ],
    notes: '',
    completedAt: null,
    created: '2026-05-11T08:00:00Z',
    etag: 'etag-psr2-v1',
  },
  {
    id: 'psr-case-3',
    caseType: 'product-sale-review',
    title: 'Product Sale Review #3',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-c',
    answers: {
      'q-cv-identity': { value: 'Yes' },
      'q-cv-method': { value: 'Document' },
      'q-cv-repeat': { value: 'No' },
      'q-ps-needs': { value: 'Yes' },
      'q-ps-product': { value: 'Standard' },
      'q-ps-suitable': { value: 'Yes' },
      'q-ps-documented': { value: 'Yes' },
      'q-co-disclosure': { value: 'Yes' },
      'q-co-consent': { value: 'Yes' },
      'q-co-channel': { value: 'Phone' },
    },
    conversation: [],
    notes: 'All questions answered — ready to complete.',
    completedAt: null,
    created: '2026-05-12T08:00:00Z',
    etag: 'etag-psr3-v1',
  },
];
