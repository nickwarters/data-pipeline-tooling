// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */

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

// Reviewer Manager report: cases assigned to user-rm (morgan manager)
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
 * example-review Cases:
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
 *   case-14 — Completed 2 months ago, fully answered, outcomeAtCompletion=pass
 *   case-15 — Completed 2 months ago, failed then Controls-amended to pass (ADR-0026)
 *   case-16 — Actions In Progress: past Send Actions, reportableAt/remediationDueDate stamped (ADR-0023/0025)
 *
 * Reviewer Manager (user-rm) report cases:
 *   rm-case-1 — Completed 5 days ago (in 7-day tile)
 *   rm-case-2 — Completed 20 days ago (in 30-day tile only)
 *   rm-case-3 — In-progress, due next week (outstanding)
 *   rm-case-4 — In-progress, OVERDUE (dueDate=yesterday)
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
        // Unified Issue Capture (ADR-0020): values captured against this failed
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
            completed: false,
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
            completed: false,
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
    // and was later corrected by Controls via a case-level Amended Outcome
    // (ADR-0026): the hand-set verdict is `pass`, with the audit stamp and the
    // re-derived ADR-0019 reporting columns. Demonstrates the observer's
    // amendment-record view and the Current Outcome (`pass`) overriding the
    // frozen `outcomeAtCompletion` (`fail`). Completed two months ago so it sits
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
    // The third lifecycle status (ADR-0023): a Case past **Send Actions** but not
    // yet closed. Exercises the storage fields stamped at the reportable milestone
    // — `reportableAt`, the +10-working-day `remediationDueDate` (ADR-0025), the
    // frozen Outcome snapshot — while `completedAt` is still null. The failed
    // Answer carries its sent Remediation Actions in the ADR-0024 object shape
    // (`{ id, text, status }`) inside the ADR-0020 `actions` capture value, with a
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
