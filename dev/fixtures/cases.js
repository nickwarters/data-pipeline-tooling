// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */

import { addWorkingDays } from '../../src/lib/add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../../src/config/working-days.js';

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
 *   complaints-case-5 — Actions In Progress: Remediation Actions sent to the
 *                       adviser (Responsible Party) and still outstanding
 *
 * @type {CaseRow[]}
 */
export const cases = [
  // --- complaints fixture cases (Complaints journey; appeals raised by the
  // Journey Owner, resolved by Controls — ADR-0027) ---
  {
    // My Team live-workload fixture: a held Case allocated to Morgan Manager's
    // first staff member.
    id: 'complaints-team-1',
    caseType: 'complaints',
    title: 'Complaint team workload #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-agent-a',
    answers: {},
    conversation: [],
    notes: '',
    onHold: true,
    placedOnHoldAt: _threeDaysAgo.toISOString(),
    completedAt: null,
    created: _fiveDaysAgo.toISOString(),
    etag: 'etag-cm-team1-v1',
  },
  {
    // A second staff member and lifecycle status exercise the multi-reviewer
    // totals shown by ?mock=1&asUser=reviewer-manager.
    id: 'complaints-team-2',
    caseType: 'complaints',
    title: 'Complaint team workload #2',
    status: 'Actions In Progress',
    assignedReviewer: 'user-reviewer-2',
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-agent-b',
    answers: {},
    conversation: [],
    notes: '',
    onHold: false,
    completedAt: null,
    created: _threeDaysAgo.toISOString(),
    etag: 'etag-cm-team2-v1',
  },
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
    onHold: true,
    placedOnHoldAt: _yesterday.toISOString(),
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
  {
    // The demo Case for **remediation sent to the adviser, work in progress**
    // (issue #495). The Assigned Reviewer answered every applicable Question,
    // selected Remediation Actions against the two failures and pressed
    // "Send Actions", so the Case sits at the reportable milestone: the Outcome
    // is frozen, `reportableAt`/`remediationDueDate` are stamped, and
    // `completedAt` is still null. One action has been worked and one is still
    // outstanding, so the adviser (`?asUser=responsible-party`) sees open work
    // on #/my-cases and the Conversation carries an unread reviewer message.
    // Field values mirror exactly what CaseMachine.transitionToActionsInProgress
    // writes — see src/lib/case-machine.js.
    id: 'complaints-case-5',
    caseType: 'complaints',
    title: 'Complaint #5',
    status: 'Actions In Progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-rp',
    answers: {
      'q-cm-ack': {
        value: 'No',
        justification: 'Acknowledgement was sent six working days late.',
        remediationActions: [
          {
            id: 'q-cm-ack-ra-0',
            text: 'Acknowledge the complaint in writing within the regulatory timeframe.',
            completed: true,
          },
        ],
        // Resolved on the Remediation tab (#499). The redress Question below is
        // deliberately left unresolved, so the demo Case shows one row of each
        // and the Reviewer's "Complete Case" button stays hidden until they
        // record the second.
        remediationStatus: { status: 'complete' },
        capture: {
          rootCauseSummary:
            'The complaint sat unallocated in the shared inbox over a bank holiday weekend.',
          failureCategory: 'Process',
          attributedTo: { loginName: 'user-rp', displayName: 'Jordan RP' },
          harmLevel: 'Minor',
          redressRequired: 'No',
        },
      },
      'q-cm-letter-structure': {
        value:
          "Correct letter structure has not been used, however this has no impact on the customer's understanding",
      },
      'q-cm-investigated': { value: 'Yes' },
      'q-cm-root-cause': { value: 'Yes' },
      'q-cm-channel': { value: 'Email' },
      'q-cm-redress': {
        value: 'No',
        justification:
          'The upheld complaint was closed before redress was calculated.',
        remediationActions: [
          {
            id: 'q-cm-redress-ra-0',
            text: 'Recalculate and offer appropriate redress to the customer.',
            completed: false,
          },
        ],
        capture: {
          rootCauseSummary:
            'Redress workflow was not triggered when the decision was changed to upheld.',
          failureCategory: 'System',
          attributedTo: { loginName: 'user-rp', displayName: 'Jordan RP' },
          harmLevel: 'Material',
          redressRequired: 'Yes',
          impactNotes: 'Customer is still out of pocket pending recalculation.',
        },
      },
      'q-cm-final-response': { value: 'Yes' },
    },
    conversation: [
      {
        author: 'user-reviewer',
        timestamp: _threeDaysAgo.toISOString(),
        body: 'Two actions are with you on this complaint: the late acknowledgement and the outstanding redress calculation.',
      },
      {
        author: 'user-rp',
        timestamp: _twoDaysAgo.toISOString(),
        body: 'Acknowledgement has been reissued to the customer. Redress is with the calculations team.',
      },
      {
        author: 'user-reviewer',
        timestamp: _yesterday.toISOString(),
        body: 'Thanks. Please confirm the redress figure before the remediation due date.',
      },
    ],
    details: {
      complaintRef: 'CMP-2026-0005',
      customerName: 'Ines Ferreira',
      complaintDate: '2026-06-02',
    },
    notes: '',
    // The review SLA due date the Case was created with. It is a different
    // clock from `remediationDueDate` — the adviser's Outstanding Remediation
    // Actions table reads `dueDate`, so leaving it unset renders an empty
    // Due Date column. Kept in the future so the Case is not also Overdue.
    dueDate: _nextWeek.toISOString(),
    reportableAt: _threeDaysAgo.toISOString(),
    remediationDueDate: addWorkingDays(
      _threeDaysAgo.toISOString(),
      REMEDIATION_SLA_WORKING_DAYS,
      ENGLAND_WALES_HOLIDAYS
    ),
    completedAt: null,
    outcomeAtCompletion: 'fail',
    hadRemediation: true,
    effectiveOutcome: 'fail',
    effectiveHadRemediation: true,
    outcomeOverridden: false,
    created: '2026-06-02T08:00:00Z',
    etag: 'etag-cm5-v1',
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
