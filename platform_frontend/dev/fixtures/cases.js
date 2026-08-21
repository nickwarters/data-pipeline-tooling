// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../src/sharepoint-client.js').Answer} Answer */

import { addWorkingDays } from '../../src/lib/add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../../src/config/working-days.js';

/**
 * The two published Question Bank versions the frozen Cases below are stamped
 * against, each naming a real artifact in `case-types/banks/`. The mock resolves
 * them by reading that file, exactly as a deploy does — so a hash here that no
 * artifact answers to shows up as a Case that falls back to the live bank.
 */
/** The January version — before the courtesy-call check was retired. */
const COMPLAINTS_BANK_V1_HASH =
  '5b4be525cff4b0321856f70662112ee6bf57d4af8399d9d0a1ae8db8d8a024cd';
/** The April version — the courtesy-call check gone, the logging question reworded. */
const COMPLAINTS_BANK_V2_HASH =
  '943c9dade830929aa91da20a91d34ddd4cf2ccec81b9b9c479a38a8e0ea98d4b';

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

// Action Centre demo clocks: reason ages for the ?asUser=action-centre persona.
const _twoDaysAgo = new Date(_todayStart.getTime() - 2 * 24 * 60 * 60 * 1000);
const _fourDaysAgo = new Date(_todayStart.getTime() - 4 * 24 * 60 * 60 * 1000);
const _sixDaysAgo = new Date(_todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
const _nineDaysAgo = new Date(_todayStart.getTime() - 9 * 24 * 60 * 60 * 1000);

const COMPLAINTS_QUESTIONS = 49;

// The one conditional Question in the Complaints catalogue: referral rights are
// only asked about where the closure deadline was missed. An Answer stored
// against a hidden Question still scores, so answering it where the deadline
// was met would move the Outcome from a Question the Reviewer never saw.
const REFERRAL_RIGHTS = 'q-cmp-0046';
const CLOSURE_DEADLINE_MET = 'Good';

/**
 * Answers the whole catalogue with one response, skipping any Question that
 * response leaves inapplicable.
 *
 * The ids are derived from the count rather than read from the Question Bank:
 * a fixture built from the bank would make any test comparing the two assert
 * the bank against itself.
 *
 * @param {string} value the response given to every applicable Question
 * @returns {Record<string, Answer>}
 */
function outcomeAnswers(value) {
  /** @type {Record<string, Answer>} */
  const answers = {};
  for (let n = 1; n <= COMPLAINTS_QUESTIONS; n += 1) {
    const id = `q-cmp-${String(n).padStart(4, '0')}`;
    if (id === REFERRAL_RIGHTS && value === CLOSURE_DEADLINE_MET) continue;
    answers[id] = { value };
  }
  return answers;
}

/**
 * The mock-served fixture Cases (`?mock=1`). complaints is the only live Case
 * Type; the example-review demo Cases moved to
 * tests/_example-review-cases.js as a test-only fixture.
 *
 * Every Complaints Question is outcome-scored, so the rule for every group
 * below is the same: a Case past the reportable milestone has been reviewed,
 * and its Answers and Outcome were frozen together. Those Cases answer the
 * catalogue through `outcomeAnswers()` and spell out only the Answers their
 * demo turns on. A row that just needs to populate a dashboard group is left
 * In-progress instead.
 *
 * Complaints (Journey Owner raises appeals, Controls resolves):
 *   complaints-case-1 — In-progress, outstanding (assigned to user-reviewer);
 *                       two failures, one decided "no remediation required" and
 *                       one still undecided
 *   complaints-case-2 — Completed, one failure → outcomeAtCompletion=poor
 *   complaints-case-3 — Completed, every applicable question failed, no appeal
 *                       (Journey Owner can still raise one; Controls sees none)
 *   complaints-case-4 — Completed, two failures with Remediation Actions and an
 *                       open (raised) appeal → ready for Controls to resolve
 *   complaints-case-5 — Actions In Progress: Remediation Actions sent to the
 *                       adviser (Responsible Party) and still outstanding
 *   complaints-case-6 — In-progress and unallocated: the candidate the
 *                       "Take a Case" allocation flow reads
 *   complaints-frozen-v1 — Completed against the January Question Bank version;
 *                       answers a question retired since, which no other Case
 *                       can show
 *   complaints-frozen-v2 — Completed against the April version, one question
 *                       fewer and one reworded
 *
 * The two frozen Cases stamp a `questionBankVersion`, so they resolve their
 * questions from that published version rather than from today's bank. Their
 * Answers therefore name only the ids their own version carries;
 * `outcomeAnswers()` would answer 46 questions neither version asks.
 *
 * My Team workload (read by ?asUser=reviewer-manager):
 *   complaints-team-1 — In-progress and on hold, under the first staff member
 *   complaints-team-2 — Actions In Progress under the second: one failure with
 *                       free-form remediation still outstanding
 *
 * Action Centre (read by ?asUser=action-centre): one row per reason group,
 * carrying the hoisted flags and clocks the real backend would compute.
 *
 * Action Centre Cases carry their current allocation time independently of
 * `created`; one deliberately makes the clocks differ. The unallocated Case
 * carries `null`, and "Request next Case" visibly stamps it.
 *
 * @type {CaseRow[]}
 */
export const cases = [
  // --- complaints fixture cases (Complaints journey; appeals raised by the
  // Journey Owner, resolved by Controls) ---
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
    responsiblePartyDisplayName: 'Frankie Agent',
    answers: {},
    conversation: [],
    notes: '',
    onHold: true,
    placedOnHoldAt: _threeDaysAgo.toISOString(),
    completedAt: null,
    created: _fiveDaysAgo.toISOString(),
    assignedAt: _fiveDaysAgo.toISOString(),
    etag: 'etag-cm-team1-v1',
  },
  {
    // A second staff member and lifecycle status exercise the multi-reviewer
    // totals shown by ?mock=1&asUser=reviewer-manager.
    //
    // Its one failure carries free-form remediation rather than a selected
    // Remediation Action, so complaints-case-5 below stays the sole "sent to
    // the adviser" demo Case.
    id: 'complaints-team-2',
    caseType: 'complaints',
    title: 'Complaint team workload #2',
    status: 'Actions In Progress',
    assignedReviewer: 'user-reviewer-2',
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-agent-b',
    responsiblePartyDisplayName: 'Rowan Agent',
    answers: {
      ...outcomeAnswers('Good'),
      'q-cmp-0016': {
        value: 'Poor',
        remediationRequired: 'yes',
        justification:
          'The upheld complaint was closed without the redress offer being checked.',
        freeFormRemediation:
          'Check the redress calculation and write to the customer with the corrected offer.',
      },
    },
    conversation: [],
    notes: '',
    onHold: false,
    reportableAt: _threeDaysAgo.toISOString(),
    remediationDueDate: addWorkingDays(
      _threeDaysAgo.toISOString(),
      REMEDIATION_SLA_WORKING_DAYS,
      ENGLAND_WALES_HOLIDAYS
    ),
    completedAt: null,
    outcomeAtCompletion: 'poor',
    hadRemediation: true,
    effectiveOutcome: 'poor',
    effectiveHadRemediation: true,
    outcomeOverridden: false,
    created: _threeDaysAgo.toISOString(),
    assignedAt: _threeDaysAgo.toISOString(),
    etag: 'etag-cm-team2-v1',
  },
  {
    // Outstanding: In-progress, assigned to the reviewer so it surfaces on the
    // reviewer dashboard's "Outstanding Cases". Only the first Question Group is
    // answered, so it is not yet completable.
    id: 'complaints-case-1',
    caseType: 'complaints',
    title: 'Complaint #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    responsiblePartyDisplayName: 'Frankie Agent',
    answers: {
      // Only the first Acknowledgement group of Questions is answered, so the
      // Case stays visibly part-way through the Review tab.
      //
      // Two of them fail, and they carry the two halves of the Remediation
      // Required demo: `q-cmp-0002` is decided **No**, so the Issues tab hides
      // its Remediation Actions entirely, while `q-cmp-0003` is left undecided,
      // which is what keeps the completion button disabled with its reason once
      // the rest of the Case is answered.
      'q-cmp-0001': { value: 'Good' },
      'q-cmp-0002': { value: 'Poor', remediationRequired: 'no' },
      'q-cmp-0003': { value: 'Poor' },
      'q-cmp-0004': { value: 'Good' },
      'q-cmp-0005': { value: 'Good' },
      'q-cmp-0006': { value: 'Good' },
      'q-cmp-0007': { value: 'Good' },
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
    assignedAt: '2026-06-18T08:00:00Z',
    etag: 'etag-cm1-v1',
  },
  {
    // Completed with exactly one failure (the redress check) → outcome `poor`.
    // Left un-amended so the Controls Amend Outcome flow and the
    // Journey Owner → Controls appeal flow can both be exercised on it.
    id: 'complaints-case-2',
    caseType: 'complaints',
    title: 'Complaint #2',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    responsiblePartyDisplayName: 'Rowan Agent',
    answers: {
      ...outcomeAnswers('Good'),
      'q-cmp-0016': {
        value: 'Poor',
        justification: 'Upheld complaint closed without offering redress.',
      },
    },
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0002',
      customerName: 'Tomasz Kowalski',
      complaintDate: '2026-05-02',
    },
    notes: '',
    completedAt: _threeDaysAgo.toISOString(),
    outcomeAtCompletion: 'poor',
    created: '2026-05-02T08:00:00Z',
    assignedAt: '2026-05-02T08:00:00Z',
    etag: 'etag-cm2-v1',
  },
  {
    // Every applicable failable question failed → outcome `poor-with-harm`, and
    // no appeal has been raised. Exercises the "no appeal" state on both appeal
    // Sections:
    // the Journey Owner sees the empty Appeal Section with the Raise Appeal form,
    // and Controls sees the Appeal Review empty state (nothing to resolve).
    // (The closure deadline is graded as missed here, so the conditional
    // referral-rights Question is applicable and answered too.)
    id: 'complaints-case-3',
    caseType: 'complaints',
    title: 'Complaint #3',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    responsiblePartyDisplayName: 'Frankie Agent',
    answers: {
      ...outcomeAnswers('Poor with harm'),
    },
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0003',
      customerName: 'Amara Okafor',
      complaintDate: '2026-05-06',
    },
    notes: '',
    completedAt: _threeDaysAgo.toISOString(),
    outcomeAtCompletion: 'poor-with-harm',
    created: '2026-05-06T08:00:00Z',
    assignedAt: '2026-05-06T08:00:00Z',
    etag: 'etag-cm3-v1',
  },
  {
    // Two failures (complaint logging + the redress check), each with a
    // selected Remediation Action, and an appeal the Journey Owner has already
    // raised. The appeal is still open (`state: 'raised'`), so Controls lands
    // straight on the Appeal Review resolve form (agree → linked Amended
    // Outcome, or reject). The Journey Owner sees their raised appeal plus the
    // "already open" note.
    id: 'complaints-case-4',
    caseType: 'complaints',
    title: 'Complaint #4',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    responsiblePartyDisplayName: 'Rowan Agent',
    answers: {
      // All-Good across the rest of the catalogue, so the Case keeps exactly the
      // two remediated failures the appeal's citedAnswerKeys point at and the
      // Controls resolve demo stays legible.
      ...outcomeAnswers('Good'),
      'q-cmp-0001': {
        value: 'Poor with harm',
        remediationRequired: 'yes',
        justification:
          'The complaint was logged four working days after it was received.',
        remediationActions: [
          {
            id: 'q-cmp-0001-ra-0',
            text: 'Log the complaint on the complaints register and correct the recorded receipt date.',
          },
        ],
      },
      'q-cmp-0016': {
        value: 'Poor with harm',
        remediationRequired: 'yes',
        justification:
          'Redress was not checked against the methodology after the upheld decision.',
        remediationActions: [
          {
            id: 'q-cmp-0016-ra-0',
            text: 'Recalculate the redress against the current methodology and offer it to the customer.',
          },
        ],
      },
    },
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0004',
      customerName: 'Tomasz Kowalski',
      complaintDate: '2026-05-09',
    },
    notes: '',
    completedAt: _fiveDaysAgo.toISOString(),
    outcomeAtCompletion: 'poor-with-harm',
    appeals: [
      {
        id: 'appeal-cm4-1',
        appellant: 'user-journey-owner-complaints',
        at: _threeDaysAgo.toISOString(),
        rationale:
          'The logging delay was caused only by a same-day system outage on our side, and the redress figure had already been checked and paid to the customer directly outside this review. Please reconsider the Poor with harm outcome.',
        citedAnswerKeys: ['q-cmp-0001', 'q-cmp-0016'],
        state: 'raised',
      },
    ],
    // The queryable pair the app's own write path hoists off that Appeal, so
    // the Controls Appeals worklist — which filters on the column, not the
    // blob — actually finds this Case.
    hasOpenAppeal: true,
    appealRaisedAt: _threeDaysAgo.toISOString(),
    created: '2026-05-09T08:00:00Z',
    assignedAt: '2026-05-09T08:00:00Z',
    etag: 'etag-cm4-v1',
  },
  {
    // The demo Case for **remediation sent to the adviser, work in progress**.
    // The Assigned Reviewer answered every applicable Question, selected
    // Remediation Actions against the two failures and pressed "Send Actions",
    // so the Case sits at the reportable milestone: the Outcome is frozen,
    // `reportableAt`/`remediationDueDate` are stamped, and `completedAt` is
    // still null. One action has been worked and one is still outstanding, so
    // the adviser (`?asUser=responsible-party`) sees open work on #/my-cases
    // and the Conversation carries an unread reviewer message. One knowing
    // divergence from what the Send Actions transition writes: the Awaiting
    // Frontline pair it also sets is not seeded here, so no demo row shows an
    // Actions In Progress Case in that Action Centre group.
    id: 'complaints-case-5',
    caseType: 'complaints',
    title: 'Complaint #5',
    status: 'Actions In Progress',
    assignedReviewer: 'user-reviewer',
    // The Reviewer's line manager. Both manager roles are resolved from the Case
    // row rather than group membership, so naming them here is what makes the
    // Remediation tab's two renderings demoable from every angle.
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-rp',
    responsiblePartyDisplayName: 'Jordan RP',
    // Their line manager, so the Remediation tab's responsible-party rendering
    // and the Conversation it points at are demoable from both sides.
    responsiblePartyManager: 'user-rp-manager',
    answers: {
      // All-Good across the rest of the catalogue adds no failures, so the
      // one-resolved/one-unresolved Remediation demo below is unchanged.
      ...outcomeAnswers('Good'),
      'q-cmp-0001': {
        value: 'Poor with harm',
        remediationRequired: 'yes',
        justification:
          'The complaint was logged six working days after it was received.',
        remediationActions: [
          {
            id: 'q-cmp-0001-ra-0',
            text: 'Log the complaint on the complaints register and correct the recorded receipt date.',
          },
        ],
        // Resolved on the Remediation tab. The redress Question below is
        // deliberately left unresolved, so the demo Case shows one row of each
        // and the Reviewer's "Complete Case" button stays disabled — with the
        // reason under it — until they record the second.
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
      'q-cmp-0016': {
        value: 'Poor with harm',
        remediationRequired: 'yes',
        justification:
          'The upheld complaint was closed before the redress calculation was checked.',
        remediationActions: [
          {
            id: 'q-cmp-0016-ra-0',
            text: 'Recalculate the redress against the current methodology and offer it to the customer.',
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
    },
    conversation: [
      {
        author: { loginName: 'user-reviewer', displayName: 'Alex Reviewer' },
        timestamp: _threeDaysAgo.toISOString(),
        body: 'Two actions are with you on this complaint: the late logging and the outstanding redress calculation.',
      },
      {
        author: { loginName: 'user-rp', displayName: 'Jordan RP' },
        timestamp: _twoDaysAgo.toISOString(),
        body: 'The register entry has been corrected. Redress is with the calculations team.',
      },
      {
        author: { loginName: 'user-reviewer', displayName: 'Alex Reviewer' },
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
    outcomeAtCompletion: 'poor-with-harm',
    hadRemediation: true,
    effectiveOutcome: 'poor-with-harm',
    effectiveHadRemediation: true,
    outcomeOverridden: false,
    created: '2026-06-02T08:00:00Z',
    assignedAt: '2026-06-02T08:00:00Z',
    etag: 'etag-cm5-v1',
  },
  {
    // The allocation candidate: sitting in `To-allocate` with no Assigned
    // Reviewer, no Responsible Party and no Answers, so the "Take a Case" flow
    // has something to offer and the claim can be seen to move it to
    // `In-progress`. Caveat for the demo: `user-reviewer` — the default
    // persona — already holds more non-held In-progress Cases than
    // the app-wide maximum of 3, so they read as at capacity; switch persona to
    // see the Case actually taken.
    id: 'complaints-case-6',
    caseType: 'complaints',
    title: 'Complaint #6',
    status: 'To-allocate',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0006',
      customerName: 'Ruth Adeyemi',
      complaintDate: '2026-07-20',
    },
    notes: '',
    completedAt: null,
    // Left null so the claim can be seen to stamp it.
    dueDate: null,
    created: _fiveDaysAgo.toISOString(),
    assignedAt: null,
    etag: 'etag-cm6-v1',
  },
  // ── as-reviewed Question Bank version demo cases ────────────
  // Both were completed against a Question Bank version that has since been
  // superseded, and each stamps that version's hash. Opening either one shows
  // the questions as they were reviewed, not today's 49 — which is why their
  // Answers name only the ids their own frozen version carries.
  {
    // Frozen at the January version: three questions, one of them the
    // courtesy-call check retired that April. That Answer is unreachable from
    // any other Case — no later version and no live bank asks the question —
    // so this row is where the freeze is visible.
    id: 'complaints-frozen-v1',
    caseType: 'complaints',
    title: 'Complaint #7 (January bank)',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    responsiblePartyDisplayName: 'Frankie Agent',
    answers: {
      'q-cmp-0001': {
        value: 'Poor',
        justification: 'Logged two days after the complaint was received.',
      },
      'q-cmp-0900': { value: 'Good' },
      'q-cmp-0016': { value: 'Good' },
    },
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0007',
      customerName: 'Priya Raman',
      complaintDate: '2026-01-14',
    },
    notes: '',
    completedAt: '2026-01-28T15:20:00Z',
    outcomeAtCompletion: 'poor',
    questionBankVersion: COMPLAINTS_BANK_V1_HASH,
    created: '2026-01-14T08:00:00Z',
    assignedAt: '2026-01-14T08:00:00Z',
    etag: 'etag-cm7-v1',
  },
  {
    // Frozen at the April version: the courtesy-call check gone and the
    // logging question reworded. Read beside the Case above, the pair shows two
    // Cases resolving different content from the same Case Type.
    id: 'complaints-frozen-v2',
    caseType: 'complaints',
    title: 'Complaint #8 (April bank)',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    responsiblePartyDisplayName: 'Rowan Agent',
    answers: {
      'q-cmp-0001': { value: 'Good' },
      'q-cmp-0016': {
        value: 'Poor',
        justification: 'Redress calculated against the superseded methodology.',
      },
    },
    conversation: [],
    details: {
      complaintRef: 'CMP-2026-0008',
      customerName: 'Callum Fraser',
      complaintDate: '2026-04-09',
    },
    notes: '',
    completedAt: '2026-04-21T11:05:00Z',
    outcomeAtCompletion: 'poor',
    questionBankVersion: COMPLAINTS_BANK_V2_HASH,
    created: '2026-04-09T08:00:00Z',
    assignedAt: '2026-04-09T08:00:00Z',
    etag: 'etag-cm8-v1',
  },
  // ── Action Centre demo cases ────────────────────────────────
  // Carry the hoisted reason flags/clocks the app's own write path produces, so
  // the ?asUser=action-centre persona sees every reason group populated. The
  // reviewer reasons are assigned to user-reviewer (the persona's id); Appeals
  // is role-scoped, not reviewer-scoped.
  {
    id: 'ac-overdue-1',
    caseType: 'complaints',
    title: 'Direct debit dispute',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-a',
    responsiblePartyDisplayName: 'Frankie Agent',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    dueDate: _yesterday.toISOString(),
    // Created earlier, then allocated nine days ago: the Action Centre must
    // show nine days in progress, never the age of the Case itself.
    created: _twentyDaysAgo.toISOString(),
    assignedAt: _nineDaysAgo.toISOString(),
    etag: 'etag-ac-od1',
  },
  {
    id: 'ac-await-1',
    caseType: 'complaints',
    title: 'Fees not refunded',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-b',
    responsiblePartyDisplayName: 'Rowan Agent',
    answers: {},
    conversation: [
      {
        author: { loginName: 'user-reviewer', displayName: 'Alex Reviewer' },
        timestamp: _nineDaysAgo.toISOString(),
        body: 'Please confirm whether the fees were refunded.',
      },
    ],
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    awaitingResponsibleParty: true,
    awaitingSince: _nineDaysAgo.toISOString(),
    created: _nineDaysAgo.toISOString(),
    assignedAt: _nineDaysAgo.toISOString(),
    etag: 'etag-ac-aw1',
  },
  {
    id: 'ac-await-2',
    caseType: 'complaints',
    title: 'Late gift declaration',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-c',
    responsiblePartyDisplayName: 'Noor Agent',
    answers: {},
    conversation: [
      {
        author: { loginName: 'user-agent-c', displayName: 'Noor Agent' },
        timestamp: _nineDaysAgo.toISOString(),
        body: 'Declaration attached.',
      },
      {
        author: { loginName: 'user-reviewer', displayName: 'Alex Reviewer' },
        timestamp: _fiveDaysAgo.toISOString(),
        body: 'The declaration is dated after the deadline — can you explain?',
      },
    ],
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    awaitingResponsibleParty: true,
    awaitingSince: _fiveDaysAgo.toISOString(),
    created: _fiveDaysAgo.toISOString(),
    assignedAt: _fiveDaysAgo.toISOString(),
    etag: 'etag-ac-aw2',
  },
  {
    id: 'ac-appeal-1',
    caseType: 'complaints',
    title: 'Interest miscalc',
    status: 'Completed',
    assignedReviewer: 'user-reviewer',
    responsibleParty: 'user-agent-c',
    responsiblePartyDisplayName: 'Noor Agent',
    answers: {
      ...outcomeAnswers('Good'),
      'q-cmp-0016': {
        value: 'Poor',
        justification: 'Upheld complaint closed without offering redress.',
      },
    },
    conversation: [],
    notes: '',
    completedAt: _twentyDaysAgo.toISOString(),
    outcomeAtCompletion: 'poor',
    appeals: [
      {
        id: 'ac-appeal-1-a1',
        appellant: 'user-agent-c',
        at: _sixDaysAgo.toISOString(),
        rationale: 'Redress was offered by phone and is not on the file.',
        state: 'raised',
      },
    ],
    hasOpenAppeal: true,
    appealRaisedAt: _sixDaysAgo.toISOString(),
    created: _twentyDaysAgo.toISOString(),
    assignedAt: _twentyDaysAgo.toISOString(),
    etag: 'etag-ac-ap1',
  },

  // --- voided Cases: the two shapes a void can take, dated so the manager
  // report on #/my-team shows one inside its 7-day column and one only inside
  // the 30-day one. Both are held by Reviewers Morgan Manager manages. ---
  {
    // Voided before the reportable milestone: no Outcome was ever stamped, so
    // the row carries none, and the Answers stop wherever the Reviewer did.
    id: 'complaints-void-1',
    caseType: 'complaints',
    title: 'Complaint raised twice',
    status: 'Void',
    assignedReviewer: 'user-reviewer',
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-agent-a',
    responsiblePartyDisplayName: 'Frankie Agent',
    answers: {
      'q-cmp-0001': { value: 'Good' },
      'q-cmp-0002': { value: 'Good' },
    },
    conversation: [],
    notes: 'Same complaint as CR-2001; closing this one.',
    onHold: false,
    placedOnHoldAt: null,
    awaitingResponsibleParty: false,
    awaitingSince: null,
    completedAt: null,
    voidReason: 'duplicate',
    voidedAt: _fourDaysAgo.toISOString(),
    voidedBy: 'user-reviewer',
    created: _nineDaysAgo.toISOString(),
    assignedAt: _nineDaysAgo.toISOString(),
    etag: 'etag-cm-void1-v1',
  },
  {
    // Voided after Send Actions: the snapshot taken at the reportable milestone
    // stays exactly as it was, and the remediation the Case had sent is left
    // frozen mid-flight — which is the state the Void banner has to explain.
    id: 'complaints-void-2',
    caseType: 'complaints',
    title: 'Complaint with no case file',
    status: 'Void',
    assignedReviewer: 'user-reviewer-2',
    assignedReviewerManager: 'user-rm',
    responsibleParty: 'user-agent-b',
    responsiblePartyDisplayName: 'Rowan Agent',
    answers: {
      ...outcomeAnswers('Good'),
      'q-cmp-0016': {
        value: 'Poor',
        remediationRequired: 'yes',
        justification: 'The redress offer could not be checked.',
        freeFormRemediation:
          'Re-check the redress calculation once the file is recovered.',
      },
    },
    conversation: [],
    notes: '',
    onHold: false,
    placedOnHoldAt: null,
    awaitingResponsibleParty: false,
    awaitingSince: null,
    reportableAt: _twentyDaysAgo.toISOString(),
    remediationDueDate: addWorkingDays(
      _twentyDaysAgo.toISOString(),
      REMEDIATION_SLA_WORKING_DAYS,
      ENGLAND_WALES_HOLIDAYS
    ),
    completedAt: null,
    outcomeAtCompletion: 'poor',
    hadRemediation: true,
    effectiveOutcome: 'poor',
    effectiveHadRemediation: true,
    outcomeOverridden: false,
    voidReason: 'no-evidence',
    voidedAt: _nineDaysAgo.toISOString(),
    voidedBy: 'user-reviewer-2',
    created: _twentyDaysAgo.toISOString(),
    assignedAt: _twentyDaysAgo.toISOString(),
    etag: 'etag-cm-void2-v1',
  },

  // Search demo rows. Three references share the `CR-20` prefix and one does
  // not, so an anchored prefix filter visibly separates them; their reportable
  // dates are spread across the last three weeks so a date window narrows
  // further rather than matching all or nothing.
  ...[
    { id: 'cr-2001', title: 'CR-2001', reportableAt: _twentyDaysAgo },
    { id: 'cr-2002', title: 'CR-2002', reportableAt: _nineDaysAgo },
    { id: 'cr-2003', title: 'CR-2003', reportableAt: _fourDaysAgo },
    { id: 'xr-2001', title: 'XR-2001', reportableAt: _yesterday },
  ].map(
    (demo) =>
      /** @type {CaseRow} */ ({
        id: demo.id,
        caseType: 'complaints',
        title: demo.title,
        status: 'Actions In Progress',
        assignedReviewer: 'user-reviewer',
        responsibleParty: 'user-agent-a',
        responsiblePartyDisplayName: 'Frankie Agent',
        // Past the reportable milestone, so the catalogue is answered and the
        // Outcome frozen, as it is on every other reportable fixture row.
        answers: outcomeAnswers('Good'),
        conversation: [],
        notes: '',
        completedAt: null,
        dueDate: _nextWeek.toISOString(),
        reportableAt: demo.reportableAt.toISOString(),
        outcomeAtCompletion: 'good',
        hadRemediation: false,
        created: demo.reportableAt.toISOString(),
        assignedAt: demo.reportableAt.toISOString(),
        etag: `etag-${demo.id}`,
      })
  ),
];
