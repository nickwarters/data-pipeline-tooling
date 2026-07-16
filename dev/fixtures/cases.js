// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */

const _now = new Date();
const _todayStart = new Date(
  _now.getFullYear(),
  _now.getMonth(),
  _now.getDate()
);
const _threeDaysAgo = new Date(_todayStart.getTime() - 3 * 24 * 60 * 60 * 1000);
const _yesterday = new Date(_todayStart.getTime() - 24 * 60 * 60 * 1000);
const _nextWeek = new Date(_todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);
const _fiveDaysAgo = new Date(_todayStart.getTime() - 5 * 24 * 60 * 60 * 1000);
const _twentyDaysAgo = new Date(
  _todayStart.getTime() - 20 * 24 * 60 * 60 * 1000
);

// Action Centre demo clocks (issue #287): reason ages for the ?asUser=action-centre persona.
const _twoDaysAgo = new Date(_todayStart.getTime() - 2 * 24 * 60 * 60 * 1000);
const _fourDaysAgo = new Date(_todayStart.getTime() - 4 * 24 * 60 * 60 * 1000);
const _sixDaysAgo = new Date(_todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
const _nineDaysAgo = new Date(_todayStart.getTime() - 9 * 24 * 60 * 60 * 1000);

/**
 * The mock-served fixture Cases (`?mock=1`). complaints is the only live Case
 * Type (issue #383); the example-review demo Cases moved to
 * tests/_example-review-cases.js as a test-only fixture.
 *
 * Complaints (Journey Owner raises appeals, Controls resolves — ADR-0027):
 *   complaints-case-1 — In-progress, outstanding (assigned to user-reviewer)
 *   complaints-case-2 — Completed, one failure → outcomeAtCompletion=refer
 *   complaints-case-3 — Completed, every applicable question failed, no appeal
 *                       (Journey Owner can still raise one; Controls sees none)
 *   complaints-case-4 — Completed, two failures with Remediation Actions and an
 *                       open (raised) appeal → ready for Controls to resolve
 *
 * @type {CaseRow[]}
 */
export const cases = [
  // --- complaints fixture cases (Complaints journey; appeals raised by the
  // Journey Owner, resolved by Controls — ADR-0027) ---
  {
    // Outstanding: In-progress, assigned to the reviewer so it surfaces on the
    // reviewer dashboard's "Outstanding Cases". Partially answered (root-cause is
    // applicable via showWhen but unanswered), so it is not yet completable.
    id: 'complaints-case-1',
    caseType: 'complaints',
    title: 'Complaint #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    answers: {
      'q-cm-ack': { value: 'Yes' },
      'q-cm-investigated': { value: 'Yes' },
    },
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0001',
      customerName: 'Priya Nair',
      complaintDate: '2026-06-18',
    },
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    created: '2026-06-18T08:00:00Z',
    etag: 'etag-cm1-v1',
  },
  {
    // Completed with exactly one failure (redress not offered) → outcome `refer`.
    // Left un-amended so the Controls Amend Outcome flow (ADR-0026) and the
    // Journey Owner → Controls appeal flow (ADR-0027) can both be exercised on it.
    id: 'complaints-case-2',
    caseType: 'complaints',
    title: 'Complaint #2',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    answers: {
      'q-cm-ack': { value: 'Yes' },
      'q-cm-investigated': { value: 'Yes' },
      'q-cm-root-cause': { value: 'Yes' },
      'q-cm-channel': { value: 'Letter' },
      'q-cm-redress': {
        value: 'No',
        justification: 'Upheld complaint closed without offering redress.',
      },
      'q-cm-final-response': { value: 'Yes' },
    },
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0002',
      customerName: 'Tomasz Kowalski',
      complaintDate: '2026-05-02',
    },
    notes: '',
    completedAt: _threeDaysAgo.toISOString(),
    outcomeAtCompletion: 'refer',
    created: '2026-05-02T08:00:00Z',
    etag: 'etag-cm2-v1',
  },
  {
    // Every applicable failable question failed → outcome `fail`, and no appeal
    // has been raised. Exercises the "no appeal" state on both appeal Sections:
    // the Journey Owner sees the empty Appeal Section with the Raise Appeal form,
    // and Controls sees the Appeal Review empty state (nothing to resolve).
    // (q-cm-root-cause is hidden because q-cm-investigated failed, so the four
    // remaining failable questions are all failed; q-cm-channel is informational.)
    id: 'complaints-case-3',
    caseType: 'complaints',
    title: 'Complaint #3',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    answers: {
      'q-cm-ack': {
        value: 'No',
        justification: 'No acknowledgement was sent to the customer.',
      },
      'q-cm-investigated': {
        value: 'No',
        justification: 'The complaint was closed without any investigation.',
      },
      'q-cm-channel': { value: 'Letter' },
      'q-cm-redress': {
        value: 'No',
        justification: 'Upheld complaint closed without offering redress.',
      },
      'q-cm-final-response': {
        value: 'No',
        justification: 'No final response was issued to the customer.',
      },
    },
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0003',
      customerName: 'Amara Okafor',
      complaintDate: '2026-05-06',
    },
    notes: '',
    completedAt: _threeDaysAgo.toISOString(),
    outcomeAtCompletion: 'fail',
    created: '2026-05-06T08:00:00Z',
    etag: 'etag-cm3-v1',
  },
  {
    // Two failures (acknowledgement + redress), each with a selected Remediation
    // Action, and an appeal the Journey Owner has already raised. The appeal is
    // still open (`state: 'raised'`), so Controls lands straight on the Appeal
    // Review resolve form (agree → linked Amended Outcome, or reject). The Journey
    // Owner sees their raised appeal plus the "already open" note.
    id: 'complaints-case-4',
    caseType: 'complaints',
    title: 'Complaint #4',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    answers: {
      'q-cm-ack': {
        value: 'No',
        justification: 'Acknowledgement was sent four working days late.',
        remediationActions: [
          {
            id: 'q-cm-ack-ra-0',
            text: 'Acknowledge the complaint in writing within the regulatory timeframe.',
            completed: false,
          },
        ],
      },
      'q-cm-investigated': { value: 'Yes' },
      'q-cm-root-cause': { value: 'Yes' },
      'q-cm-channel': { value: 'Email' },
      'q-cm-redress': {
        value: 'No',
        justification:
          'Redress was not recalculated after the upheld decision.',
        remediationActions: [
          {
            id: 'q-cm-redress-ra-0',
            text: 'Recalculate and offer appropriate redress to the customer.',
            completed: false,
          },
        ],
      },
      'q-cm-final-response': { value: 'Yes' },
    },
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0004',
      customerName: 'Tomasz Kowalski',
      complaintDate: '2026-05-09',
    },
    notes: '',
    completedAt: _fiveDaysAgo.toISOString(),
    outcomeAtCompletion: 'fail',
    appeals: [
      {
        id: 'appeal-cm4-1',
        appellant: 'user-journey-owner-complaints',
        at: _threeDaysAgo.toISOString(),
        rationale:
          'The acknowledgement was delayed only by a same-day system outage on our side, and redress had already been paid to the customer directly outside this review. Please reconsider the Fail outcome.',
        citedAnswerKeys: ['q-cm-ack', 'q-cm-redress'],
        state: 'raised',
      },
    ],
    created: '2026-05-09T08:00:00Z',
    etag: 'etag-cm4-v1',
  },
  // ── Action Centre demo cases (issue #287) ────────────────────────────────
  // Carry the hoisted reason flags/clocks the real backend would compute, so
  // the ?asUser=action-centre persona sees every reason group populated. The
  // reviewer reasons are assigned to user-reviewer (the persona's id); Appeals
  // and Reopened are role-scoped, not reviewer-scoped.
  {
    id: 'ac-overdue-1',
    caseType: 'complaints',
    title: 'Direct debit dispute',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _yesterday.toISOString(),
    overdue: true,
    created: _nineDaysAgo.toISOString(),
    etag: 'etag-ac-od1',
  },
  {
    id: 'ac-await-1',
    caseType: 'complaints',
    title: 'Fees not refunded',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    awaitingResponsibleParty: true,
    awaitingSince: _nineDaysAgo.toISOString(),
    created: _nineDaysAgo.toISOString(),
    etag: 'etag-ac-aw1',
  },
  {
    id: 'ac-await-2',
    caseType: 'complaints',
    title: 'Late gift declaration',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-c',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    awaitingResponsibleParty: true,
    awaitingSince: _fiveDaysAgo.toISOString(),
    created: _fiveDaysAgo.toISOString(),
    etag: 'etag-ac-aw2',
  },
  {
    id: 'ac-review-1',
    caseType: 'complaints',
    title: 'Affordability recheck',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    reviewRequired: true,
    created: _fourDaysAgo.toISOString(),
    etag: 'etag-ac-rr1',
  },
  {
    id: 'ac-review-2',
    caseType: 'complaints',
    title: 'Income evidence',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    reviewRequired: true,
    created: _twoDaysAgo.toISOString(),
    etag: 'etag-ac-rr2',
  },
  {
    id: 'ac-appeal-1',
    caseType: 'complaints',
    title: 'Interest miscalc',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-c',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: _twentyDaysAgo.toISOString(),
    outcomeAtCompletion: 'refer',
    hasOpenAppeal: true,
    appealRaisedAt: _sixDaysAgo.toISOString(),
    created: _twentyDaysAgo.toISOString(),
    etag: 'etag-ac-ap1',
  },
  {
    id: 'ac-reopened-1',
    caseType: 'complaints',
    title: 'Outside business interest',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    reopened: true,
    reopenedAt: _fiveDaysAgo.toISOString(),
    created: _twentyDaysAgo.toISOString(),
    etag: 'etag-ac-re1',
  },
];
