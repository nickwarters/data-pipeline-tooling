// @ts-check
// Test-only fixture: the example-review demo Cases. `example-review` was retired
// from the production manifest and the mock client (complaints is
// the only live Case Type), but its Cases remain the canonical exercise of the
// case-review flow across the test suite. They live here — not in
// dev/fixtures/cases.js — so `?mock=1` serves complaints alone and nothing
// outside the tests carries example-review.
//
// Pairs with _example-review-case-type.js (the Case Type config) and
// _example-review-bank.txt (its Question Bank).
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

const _now = new Date();
const _todayStart = new Date(
  _now.getFullYear(),
  _now.getMonth(),
  _now.getDate()
);
const _threeDaysAgo = new Date(_todayStart.getTime() - 3 * 24 * 60 * 60 * 1000);
const _twoMonthsAgo = new Date(_todayStart);
_twoMonthsAgo.setMonth(_twoMonthsAgo.getMonth() - 2);
const _yesterday = new Date(_todayStart.getTime() - 24 * 60 * 60 * 1000);
const _nextWeek = new Date(_todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);
const _fiveDaysAgo = new Date(_todayStart.getTime() - 5 * 24 * 60 * 60 * 1000);
const _twentyDaysAgo = new Date(
  _todayStart.getTime() - 20 * 24 * 60 * 60 * 1000
);

/**
 * The example-review demo Cases (case-1..16 plus the Reviewer Manager rm-case-*
 * set). Filtered by `caseType === 'example-review'` in the tests that use them.
 *
 * @type {CaseRow[]}
 */
export const exampleReviewCases = [
  {
    id: 'case-1',
    caseType: 'example-review',
    title: 'Example Review #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    answers: {},
    conversation: [],
    details: {
      customerName: 'Jordan Lee',
      accountNumber: 'ACC-4471',
      interactionDate: '2026-04-29',
    },
    notes: '',
    completedAt: null,
    created: '2026-05-01T08:00:00Z',
    etag: 'etag-c1-v1',
  },
  {
    id: 'case-2',
    caseType: 'example-review',
    title: 'Example Review #2',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    answers: {
      'q-welcome': { value: 'Yes' },
    },
    conversation: [
      {
        author: 'user-reviewer',
        timestamp: '2026-05-07T09:00:00Z',
        body: 'Please confirm the greeting script used.',
      },
      {
        author: 'user-agent-b',
        timestamp: '2026-05-07T09:15:00Z',
        body: 'Standard greeting was used per policy.',
      },
    ],
    notes: '',
    completedAt: null,
    created: '2026-05-02T08:00:00Z',
    etag: 'etag-c2-v1',
  },
  {
    id: 'case-3',
    caseType: 'example-review',
    title: 'Example Review #3',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-c',
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': {
        value: 'No',
        justification:
          'Agent jumped straight to resolution without confirming the issue.',
        attributedParty: {
          loginName: 'agent.c',
          displayName: 'Agent C (Casey Doyle)',
        },
        // Unified Issue Capture: values captured against this failed
        // Answer, keyed by CaptureField.key, demonstrating the four string types.
        capture: {
          rootCause: 'Skipped the needs-identification step',
          whatHappened:
            'Agent moved to a billing fix before confirming the caller’s actual issue.',
          severity: 'Med',
          repeatIssue: 'No',
        },
      },
      'q-channel': { value: 'Phone' },
      'q-products': { value: ['Billing'] },
    },
    conversation: [],
    notes: 'All applicable questions answered — ready to complete.',
    caseJustification:
      'Reviewed against the Q2 contact-handling policy; resolution path was acceptable despite the missed needs check.',
    completedAt: null,
    created: '2026-05-03T08:00:00Z',
    etag: 'etag-c3-v1',
  },
  {
    id: 'case-4',
    caseType: 'example-review',
    title: 'Example Review #4',
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
    caseType: 'example-review',
    title: 'Example Review #5',
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
    caseType: 'example-review',
    title: 'Example Review #6',
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
    caseType: 'example-review',
    title: 'Example Review #7',
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
    caseType: 'example-review',
    title: 'Example Review #8',
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
    caseType: 'example-review',
    title: 'Example Review #9',
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
    caseType: 'example-review',
    title: 'Example Review #10',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {
      'q-needs': {
        value: 'No',
        justification: 'Needs improvement',
        remediationActions: [
          {
            id: 'ra-10-1',
            text: 'Ensure agent identifies customer needs before proceeding',
          },
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
    caseType: 'example-review',
    title: 'Example Review #11',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {
      'q-welcome': {
        value: 'No',
        remediationActions: [
          {
            id: 'ra-11-1',
            text: 'Review greeting standards and apply correct opening',
          },
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
    caseType: 'example-review',
    title: 'Example Review #12',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [
      {
        author: 'user-reviewer',
        timestamp: '2026-05-07T09:00:00Z',
        body: 'Please clarify the greeting used.',
      },
      {
        author: 'user-rp',
        timestamp: '2026-05-07T09:30:00Z',
        body: 'Standard greeting was used.',
      },
      {
        author: 'user-reviewer',
        timestamp: '2026-05-07T10:00:00Z',
        body: 'Can you provide the exact wording?',
      },
    ],
    notes: '',
    completedAt: null,
    created: '2026-05-03T08:00:00Z',
    etag: 'etag-c12-v1',
  },
  {
    id: 'case-13',
    caseType: 'example-review',
    title: 'Example Review #13',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {},
    conversation: [
      {
        author: 'user-reviewer',
        timestamp: '2026-05-08T09:00:00Z',
        body: 'Please respond to review queries.',
      },
    ],
    notes: '',
    completedAt: null,
    created: '2026-05-04T08:00:00Z',
    etag: 'etag-c13-v1',
  },
  {
    // A plain Completed example-review Case (all Answers passed). Completed two
    // months ago so it sits outside the owner roll-up's 7-day window.
    id: 'case-14',
    caseType: 'example-review',
    title: 'Example Review #14',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'Yes' },
      'q-resolve': { value: 'Yes' },
      'q-channel': { value: 'Phone' },
      'q-products': { value: ['Account'] },
    },
    conversation: [],
    notes: '',
    completedAt: _twoMonthsAgo.toISOString(),
    outcomeAtCompletion: 'pass',
    created: '2026-04-05T08:00:00Z',
    etag: 'etag-c14-v1',
  },
  {
    // A Completed example-review Case that FAILED at completion (q-needs = No)
    // and was later corrected by Controls via a case-level Amended Outcome: the
    // hand-set verdict is `pass`, with the audit stamp and the re-derived
    // reporting columns. Demonstrates the observer's amendment-record
    // view and the Current Outcome (`pass`) overriding the frozen
    // `outcomeAtCompletion` (`fail`). Completed two months ago so it sits
    // outside the owner roll-up's 7-day window.
    id: 'case-15',
    caseType: 'example-review',
    title: 'Example Review #15',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-h',
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': {
        value: 'No',
        justification: 'Agent skipped the needs-identification step.',
      },
      'q-channel': { value: 'Phone' },
      'q-products': { value: ['Billing'] },
    },
    conversation: [],
    notes: '',
    completedAt: _twoMonthsAgo.toISOString(),
    outcomeAtCompletion: 'fail',
    amendedOutcome: {
      outcome: 'pass',
      justification:
        'On review the missed needs check was immaterial to the resolution; the interaction met standard on all other measures.',
      amendedBy: 'user-controls',
      amendedAt: _twoMonthsAgo.toISOString(),
    },
    effectiveOutcome: 'pass',
    outcomeOverridden: true,
    effectiveHadRemediation: false,
    created: '2026-04-06T08:00:00Z',
    etag: 'etag-c15-v1',
  },
  {
    // The third lifecycle status: a Case past **Send Actions** but not
    // yet closed. Exercises the storage fields stamped at the reportable milestone
    // — `reportableAt`, the +10-working-day `remediationDueDate`, the
    // frozen Outcome snapshot — while `completedAt` is still null. The failed
    // Answer carries its sent Remediation Actions in the object shape
    // (`{ id, text, status }`) inside the `actions` capture value, with a
    // legacy bare string alongside to exercise read-time coercion.
    id: 'case-16',
    caseType: 'example-review',
    title: 'Example Review #16',
    status: 'Actions In Progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-i',
    answers: {
      'q-welcome': { value: 'Yes' },
      'q-needs': {
        value: 'No',
        justification: 'Agent skipped the needs-identification step.',
        capture: {
          rootCause: 'Skipped the needs-identification step',
          remediationActions: [
            {
              id: 'ra-16-1',
              text: 'Retrain agent on needs-identification protocol.',
              status: 'pending',
            },
            'Add needs-check prompt to the call script.',
          ],
        },
      },
      'q-channel': { value: 'Phone' },
      'q-products': { value: ['Billing'] },
    },
    conversation: [],
    notes: '',
    reportableAt: _threeDaysAgo.toISOString(),
    remediationDueDate: _nextWeek.toISOString(),
    completedAt: null,
    outcomeAtCompletion: 'fail',
    hadRemediation: true,
    effectiveOutcome: 'fail',
    effectiveHadRemediation: true,
    outcomeOverridden: false,
    created: '2026-05-08T08:00:00Z',
    etag: 'etag-c16-v1',
  },
  // --- Reviewer Manager (user-rm) report fixture cases ---
  {
    id: 'rm-case-1',
    caseType: 'example-review',
    title: 'Example Review #RM-1',
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
    caseType: 'example-review',
    title: 'Example Review #RM-2',
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
    caseType: 'example-review',
    title: 'Example Review #RM-3',
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
    caseType: 'example-review',
    title: 'Example Review #RM-4',
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
];
