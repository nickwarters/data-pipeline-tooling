// @ts-check
/**
 * Reason model for the dashboard **Action Centre** worklist.
 *
 * The Action Centre merges the per-role dashboard tables (Overdue, Awaiting
 * Frontline, Appeals to work, …) into one
 * urgency-ranked, reason-grouped list. This module is the pure, data-only core:
 * an ordered table of **reasons**, plus the helpers that turn a Case row into
 * its reason chip, role tag, "waiting" age and sub-line. It performs no I/O —
 * the component wires these to the `SharePointClient` `countCases` / paged
 * `listCases` methods.
 *
 * Every reason is defined by an **indexed** `ListCasesFilter` so its group-header
 * count is a cheap `$count` and never a blob parse. Each
 * reason measures its own clock from a queryable date column (`clockField`), so
 * groups sort independently and no cross-reason ranking is needed.
 *
 * Reviewer reasons are **scoped to the current reviewer** (`reviewerScoped`), so
 * a reviewer's worklist shows only their own assigned Cases; Controls/Owner
 * reasons stay unscoped.
 *
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter
 * @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions
 * @typedef {import('./permissions.js').Capabilities} Capabilities
 */

/**
 * @typedef {{
 * id: string,
 * label: string,
 * role: string,
 * tone: 'overdue' | 'awaiting' | 'hold' | 'appeal' | 'progress',
 * clockField: 'dueDate' | 'awaitingSince' | 'placedOnHoldAt' | 'appealRaisedAt' | 'assignedAt',
 * flagField?: 'overdue' | 'awaitingResponsibleParty' | 'onHold' | 'hasOpenAppeal',
 * filter: ListCasesFilter,
 * defaultSlaDays: number,
 * reviewerScoped: boolean,
 * requires: (capabilities: Capabilities) => boolean,
 * waitingLabel: (days: number) => string,
 * subLine: (caseRow: CaseRow) => string,
 * }} Reason
 */

import { APPEALS_ENABLED } from '../config/features.js';
import { CASE_STATUS, OUTSTANDING_STATUSES } from '../lib/case-statuses.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `N day` / `N days`, guarding the singular. Callers wrap this with the
 * reason-specific phrasing (e.g. `… over`, `raised … ago`).
 *
 * @param {number} days
 * @returns {string}
 */
function dayCount(days) {
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Reviewer sub-line: the Responsible Party (when known) and the assignee, e.g.
 * "A. Bello · assigned to J. Okoro" or, unassigned-RP, "assigned to M. Diallo".
 *
 * @param {CaseRow} caseRow
 * @returns {string}
 */
function assigneeSubLine(caseRow) {
  return [
    caseRow.responsibleParty,
    caseRow.assignedReviewer ? `assigned to ${caseRow.assignedReviewer}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The reason table, in fixed priority order (Overdue → Awaiting Frontline →
 * On Hold → Appeals → In progress).
 *
 * The Reviewer groups are **mutually exclusive**: a Case appears in exactly one
 * of Overdue, Awaiting Frontline, On Hold and In progress, the first it matches
 * in that order. Each group below the first therefore negates every Reviewer
 * flag above it, and In progress — which sets no flag of its own — is the
 * residue: the outstanding work that is none of the three. So the four counts
 * sum to the Reviewer's whole worklist and never double-count a Case, and the
 * question "where is this Case?" has one answer.
 *
 * The exclusivity lives in the **filter**, never at render time, so a group's
 * header count, its collapsed one-line peek and its paged rows are all answers
 * to the same query. That costs three negated `Yes/No` predicates, which is
 * only sound because a negated flag matches an unset column as well as an
 * explicit No; while it did not, these groups would have been full in the mock
 * and empty on live.
 *
 * A flag above the group a Case is shown in is still worth saying, and
 * `secondaryReasons` still says it: an overdue Case that is also parked reads
 * "also on hold" under Overdue, which is what explains its absence from the On
 * Hold group.
 *
 * Appeals is a Controls group, not a Reviewer one, and sits outside this
 * ordering.
 *
 * `defaultSlaDays` is the framework cadence for a reason — what a Case Type
 * gets when it declares nothing. A Case Type overrides it per reason; it
 * cannot add a reason.
 *
 * @type {Reason[]}
 */
export const ACTION_CENTRE_REASONS = [
  {
    id: 'overdue',
    label: 'Overdue',
    role: 'Reviewer',
    tone: 'overdue',
    clockField: 'dueDate',
    flagField: 'overdue',
    filter: { overdue: true },
    defaultSlaDays: 0,
    reviewerScoped: true,
    requires: (c) => c.isReviewer,
    waitingLabel: (days) => `${dayCount(days)} over`,
    subLine: assigneeSubLine,
  },
  {
    id: 'awaitingFrontline',
    label: 'Awaiting Frontline',
    role: 'Reviewer',
    tone: 'awaiting',
    clockField: 'awaitingSince',
    flagField: 'awaitingResponsibleParty',
    // Overdue wins, the same way it wins over On Hold below: a Case whose
    // review date has passed is urgent whoever the ball is with.
    filter: { awaitingResponsibleParty: true, overdue: false },
    // The 7-day cadence and "no reply" wording apply to Conversation-flagged
    // rows. An `Actions In Progress` row is judged and worded from its
    // stored `remediationDueDate` instead — see `waitingInfo`.
    defaultSlaDays: 7,
    reviewerScoped: true,
    requires: (c) => c.isReviewer,
    waitingLabel: (days) => `${dayCount(days)} no reply`,
    subLine: assigneeSubLine,
  },
  {
    id: 'onHold',
    label: 'On Hold',
    role: 'Reviewer',
    tone: 'hold',
    clockField: 'placedOnHoldAt',
    flagField: 'onHold',
    // Everything above On Hold wins: a parked Case that has also blown its
    // review date is urgent, not parked, and one that is out with the
    // Frontline is waiting on someone, not parked. Expressed in the filter
    // rather than at render time so the header count, the collapsed peek and
    // the paged rows all agree.
    filter: { onHold: true, overdue: false, awaitingResponsibleParty: false },
    // A placeholder cadence for "parked too long", pending a product answer.
    // Zero would read every parked Case as breached, which would defeat the
    // point of a separate non-urgent group.
    defaultSlaDays: 14,
    reviewerScoped: true,
    requires: (c) => c.isReviewer,
    waitingLabel: (days) => `${dayCount(days)} on hold`,
    subLine: assigneeSubLine,
  },
  {
    id: 'appeals',
    label: 'Appeals to work',
    role: 'Controls',
    tone: 'appeal',
    clockField: 'appealRaisedAt',
    flagField: 'hasOpenAppeal',
    filter: { hasOpenAppeal: true },
    defaultSlaDays: 5,
    reviewerScoped: false,
    // Appeals are switched off in this build: nothing sets the flag this group
    // queries, so it would be an empty group on every Controls worklist.
    requires: (c) => {
      if (!APPEALS_ENABLED) return false;
      return c.isControls;
    },
    waitingLabel: (days) => `raised ${dayCount(days)} ago`,
    subLine: assigneeSubLine,
  },
  {
    id: 'inProgress',
    label: 'In progress',
    role: 'Reviewer',
    tone: 'progress',
    // Ages from the current allocation, so reassignment starts the current
    // Reviewer's in-progress clock when the Case is handed to them.
    clockField: 'assignedAt',
    // No flagField: this group is a status, not a state something sets, and as
    // the residue of the three above it can never be a *second* reason on a row
    // either — a Case in another group is by construction not in this one.
    filter: {
      assignedAtPresent: true,
      anyOf: OUTSTANDING_STATUSES.map((status) => ({ status })),
      overdue: false,
      awaitingResponsibleParty: false,
      onHold: false,
    },
    // A placeholder cadence for "held too long", pending a product answer —
    // the same open question On Hold carries.
    defaultSlaDays: 14,
    reviewerScoped: true,
    requires: (c) => c.isReviewer,
    waitingLabel: (days) => `${dayCount(days)} in progress`,
    subLine: assigneeSubLine,
  },
];

/**
 * The reason for an id, or undefined.
 *
 * @param {string} id
 * @returns {Reason | undefined}
 */
function reasonById(id) {
  return ACTION_CENTRE_REASONS.find((r) => r.id === id);
}

/**
 * The reasons a user with these capabilities can act on — the union across all
 * roles they hold, so a multi-role user sees one merged worklist.
 *
 * @param {Capabilities} capabilities
 * @returns {Reason[]}
 */
export function reasonsForCapabilities(capabilities) {
  return ACTION_CENTRE_REASONS.filter((r) => r.requires(capabilities));
}

/**
 * The filter to query for a reason. A `reviewerScoped` reason is narrowed to the
 * current reviewer's own Cases so a reviewer never sees another reviewer's work;
 * Controls/Owner reasons are returned unscoped.
 *
 * @param {Reason} reason
 * @param {string} currentUserId
 * @returns {ListCasesFilter}
 */
export function activeFilter(reason, currentUserId) {
  return reason.reviewerScoped
    ? { ...reason.filter, assignedReviewer: currentUserId }
    : reason.filter;
}

/**
 * The deduped-headline filter: the OR of every visible reason's active filter,
 * server-deduped so a case counted in two groups is the "N cases need you"
 * headline only once. Deliberately not the sum of per-group counts.
 *
 * @param {Reason[]} reasons
 * @param {string} currentUserId
 * @returns {ListCasesFilter}
 */
export function headlineFilter(reasons, currentUserId) {
  return { anyOf: reasons.map((r) => activeFilter(r, currentUserId)) };
}

/**
 * Paging/order options that put a group's **worst** item first — oldest on the
 * reason's own clock. Used both for the per-group page and the collapsed-header
 * one-line peek (`{ top: 1 }`).
 *
 * @param {Reason} reason
 * @returns {CaseListOptions}
 */
export function worstFirstOrder(reason) {
  return { orderBy: reason.clockField, orderDir: 'asc' };
}

/**
 * The worst-first comparator for a reason: ascending on the reason's own
 * clock field (oldest/most-overdue first), matching `worstFirstOrder`'s
 * `orderBy`/`orderDir`. A missing clock sorts as `''`, i.e. first — the same
 * convention `MockSharePointClient`/`HttpSharePointClient` use for `orderBy`.
 * The In progress server query excludes rows without an allocation clock.
 * Shared by the single-list `listCases({ orderBy, orderDir })` request and the
 * client-side merge of several lists' results, so both agree on "worst".
 *
 * @param {Reason} reason
 * @returns {(a: CaseRow, b: CaseRow) => number}
 */
function reasonOrderComparator(reason) {
  return (a, b) => {
    const av = /** @type {string} */ (a[reason.clockField] ?? '');
    const bv = /** @type {string} */ (b[reason.clockField] ?? '');
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  };
}

/**
 * The single global worst Case among several per-list "worst" candidates — one
 * per Case source, each already the worst item of its own list (or `null` if
 * that list had no match). A Case lives in exactly one list, so the global
 * worst is simply the earliest, by the reason's clock, among these per-list
 * winners: no case can be worse than its own list's worst, so comparing just
 * the per-list winners is enough to find the true global worst without
 * fetching every row.
 *
 * @param {(CaseRow | null)[]} candidates
 * @param {Reason} reason
 * @returns {CaseRow | null}
 */
export function pickGlobalWorst(candidates, reason) {
  const cmp = reasonOrderComparator(reason);
  return candidates.reduce(
    /** @param {CaseRow | null} worst @param {CaseRow | null} candidate */
    (worst, candidate) => {
      if (!candidate) return worst;
      if (!worst) return candidate;
      return cmp(candidate, worst) < 0 ? candidate : worst;
    },
    /** @type {CaseRow | null} */ (null)
  );
}

/**
 * The global worst-first window `[skip, skip + top)` across several lists,
 * given each list's own worst-first rows **over-fetched to `skip + top`**
 * (i.e. each list's own top `skip + top`, from its own start). Because a
 * Case's rank within its own list can never exceed its rank across every
 * list combined (adding more lists' Cases to the comparison can only push a
 * Case's global rank down, never up), every Case that belongs in the true
 * global top `skip + top` is guaranteed to appear in *some* list's local top
 * `skip + top` — so concatenating those per-list prefixes, re-sorting by the
 * same worst-first order, and slicing `[skip, skip + top)` yields exactly the
 * true global window, with no need to fetch every row of every list.
 *
 * @param {CaseRow[][]} perSourceRows
 * @param {Reason} reason
 * @param {number} skip
 * @param {number} top
 * @returns {CaseRow[]}
 */
export function mergeWorstFirstWindow(perSourceRows, reason, skip, top) {
  const merged = perSourceRows.flat().sort(reasonOrderComparator(reason));
  return merged.slice(skip, skip + top);
}

/**
 * Whole days a Case has been waiting on a reason's clock. Never negative; a
 * missing clock reads as 0.
 *
 * @param {CaseRow} caseRow
 * @param {Reason} reason
 * @param {Date} [now]
 * @returns {number}
 */
function daysWaiting(caseRow, reason, now = new Date()) {
  const at = /** @type {string | null | undefined} */ (
    caseRow[reason.clockField]
  );
  if (!at) return 0;
  const clockTime = Date.parse(at);
  if (Number.isNaN(clockTime)) return 0;
  const diff = now.getTime() - clockTime;
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

/**
 * The waiting chip for an `Actions In Progress` Case in the Awaiting
 * Frontline group: judged against the working-day `remediationDueDate`
 * stamped on the row at Send Actions, not the reason's age-versus-cadence
 * rule. The stored date is read, never re-derived from a cadence, so this
 * chip and the Remediation tab can never disagree across a bank holiday.
 * `days` stays the days waiting on the reason's own clock, so the age is
 * still reported; only the wording and the breach judgement move to the
 * due date.
 *
 * @param {CaseRow} caseRow
 * @param {Reason} reason
 * @param {Date} now
 * @returns {{ days: number, label: string, breached: boolean }}
 */
function dueDateInfo(caseRow, reason, now) {
  const due = new Date(
    `${String(caseRow.remediationDueDate).slice(0, 10)}T00:00:00.000Z`
  );
  const overDays = Math.floor((now.getTime() - due.getTime()) / MS_PER_DAY);
  const label =
    overDays > 0
      ? `${dayCount(overDays)} over`
      : overDays === 0
        ? 'due today'
        : `due in ${dayCount(-overDays)}`;
  return {
    days: daysWaiting(caseRow, reason, now),
    label,
    breached: overDays > 0,
  };
}

/**
 * The "waiting" chip for a Case in a reason group: its age, the reason-specific
 * label, and whether it has breached the SLA (drives the urgent styling and the
 * "Needs action now" emphasis). `slaDays` defaults to the reason's own
 * framework cadence; a caller that knows the Case's Case Type passes that Case
 * Type's cadence instead, and an absent one falls back here.
 *
 * An `Actions In Progress` Case in the Awaiting Frontline group is the one
 * exception: it is judged against its stored `remediationDueDate` instead of
 * this age-versus-cadence rule — the `slaDays` override does not apply to
 * those rows, because the stored date already encodes the Case Type's
 * remediation SLA in working days. Every other row keeps the cadence rule
 * below.
 *
 * @param {CaseRow} caseRow
 * @param {Reason} reason
 * @param {Date} [now]
 * @param {number} [slaDays]
 * @returns {{ days: number, label: string, breached: boolean }}
 */
export function waitingInfo(
  caseRow,
  reason,
  now = new Date(),
  slaDays = reason.defaultSlaDays
) {
  if (
    reason.id === 'awaitingFrontline' &&
    caseRow.status === CASE_STATUS.ACTIONS_IN_PROGRESS &&
    caseRow.remediationDueDate
  ) {
    return dueDateInfo(caseRow, reason, now);
  }
  const days = daysWaiting(caseRow, reason, now);
  return {
    days,
    label: reason.waitingLabel(days),
    breached: days >= slaDays,
  };
}

/**
 * The reason ids a Case row matches, by its hoisted flags, in priority order.
 * Used to pick a primary reason and note the rest inline ("also overdue").
 *
 * In progress is absent by construction — it carries no flag, being the residue
 * of the three that do — so "also in progress" is unsayable, which is right: a
 * Case in another group is not in the In progress one.
 *
 * @param {CaseRow} caseRow
 * @returns {string[]}
 */
function matchedReasonIds(caseRow) {
  // A reason with no flag of its own is skipped.
  return ACTION_CENTRE_REASONS.filter(
    (r) => r.flagField !== undefined && Boolean(caseRow[r.flagField])
  ).map((r) => r.id);
}

/**
 * The secondary reasons a Case qualifies for beyond the group it is shown in —
 * the inline "also …" note on its row. Empty when the case only has the one
 * reason.
 *
 * The Reviewer groups are mutually exclusive, so this is no longer a note about
 * a row that could have been in two places. It is the opposite: the row is in
 * exactly one group, and this says which flags it *also* carries — which is
 * what accounts for its absence from the groups those flags name. An overdue,
 * parked Case appears under Overdue reading "also on hold", and is nowhere else.
 *
 * @param {CaseRow} caseRow
 * @param {string} primaryReasonId
 * @returns {Reason[]}
 */
export function secondaryReasons(caseRow, primaryReasonId) {
  return matchedReasonIds(caseRow)
    .filter((id) => id !== primaryReasonId)
    .map((id) => /** @type {Reason} */ (reasonById(id)));
}
