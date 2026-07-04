// @ts-check
/**
 * Reason model for the dashboard **Action Centre** worklist (issue #287).
 *
 * The Action Centre merges the per-role dashboard tables (Overdue, Awaiting
 * Frontline, Review Required, Appeals to work, Reopened, …) into one
 * urgency-ranked, reason-grouped list. This module is the pure, data-only core:
 * an ordered table of **reasons**, plus the helpers that turn a Case row into
 * its reason chip, role tag, "waiting" age and sub-line. It performs no I/O —
 * the component wires these to the `SharePointClient` `countCases` / paged
 * `listCases` methods.
 *
 * Every reason is defined by an **indexed** `ListCasesFilter` so its group-header
 * count is a cheap `$count` and never a blob parse (ties to ADR-0007). Each
 * reason measures its own clock from a queryable date column (`clockField`), so
 * groups sort independently and no cross-reason ranking is needed.
 *
 * Reviewer reasons are **scoped to the current reviewer** (`reviewerScoped`), so
 * a reviewer's worklist shows only their own assigned Cases; Controls/Owner
 * reasons stay unscoped. The `tailOnly` reasons (Review Required) are the
 * within-SLA backlog and are hidden by the "Needs action now" toggle.
 *
 * @typedef {import('../sharepoint-client.js').CaseRow} CaseRow
 * @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter
 * @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions
 * @typedef {import('./permissions.js').Capabilities} Capabilities
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   role: string,
 *   tone: 'overdue' | 'awaiting' | 'review' | 'appeal' | 'reopened',
 *   clockField: 'dueDate' | 'awaitingSince' | 'created' | 'appealRaisedAt' | 'reopenedAt',
 *   flagField: 'overdue' | 'awaitingResponsibleParty' | 'reviewRequired' | 'hasOpenAppeal' | 'reopened',
 *   filter: ListCasesFilter,
 *   slaDays: number,
 *   reviewerScoped: boolean,
 *   tailOnly: boolean,
 *   requires: (capabilities: Capabilities) => boolean,
 *   waitingLabel: (days: number) => string,
 *   subLine: (caseRow: CaseRow) => string,
 * }} Reason
 */

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
 * Review Required → Appeals → Reopened). Group ordering is this fixed priority;
 * the primary reason of a multi-reason case is the earliest match here.
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
    slaDays: 0,
    reviewerScoped: true,
    tailOnly: false,
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
    filter: { awaitingResponsibleParty: true },
    slaDays: 7,
    reviewerScoped: true,
    tailOnly: false,
    requires: (c) => c.isReviewer,
    waitingLabel: (days) => `${dayCount(days)} no reply`,
    subLine: assigneeSubLine,
  },
  {
    id: 'reviewRequired',
    label: 'Review Required',
    role: 'Reviewer',
    tone: 'review',
    clockField: 'created',
    flagField: 'reviewRequired',
    filter: { reviewRequired: true },
    slaDays: 14,
    reviewerScoped: true,
    // The within-SLA backlog: the reviewer's remaining in-flight Cases that
    // aren't overdue or awaiting a reply. Hidden until the "All" toggle.
    tailOnly: true,
    requires: (c) => c.isReviewer,
    waitingLabel: (days) => `${dayCount(days)} open`,
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
    slaDays: 5,
    reviewerScoped: false,
    tailOnly: false,
    requires: (c) => c.isControls,
    waitingLabel: (days) => `raised ${dayCount(days)} ago`,
    subLine: assigneeSubLine,
  },
  {
    id: 'reopened',
    label: 'Reopened',
    role: 'Owner',
    tone: 'reopened',
    clockField: 'reopenedAt',
    flagField: 'reopened',
    filter: { reopened: true },
    slaDays: 3,
    reviewerScoped: false,
    tailOnly: false,
    requires: (c) => c.ownedCaseTypes.length > 0,
    waitingLabel: (days) => dayCount(days),
    subLine: () => 'appeal upheld · back under review',
  },
];

/**
 * The reason for an id, or undefined.
 *
 * @param {string} id
 * @returns {Reason | undefined}
 */
export function reasonById(id) {
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
 * The reasons visible under the current toggle. "Needs action now" hides the
 * `tailOnly` within-SLA backlog (Review Required); "All" shows everything.
 *
 * @param {Reason[]} reasons
 * @param {boolean} needsActionNow
 * @returns {Reason[]}
 */
export function visibleReasons(reasons, needsActionNow) {
  return needsActionNow ? reasons.filter((r) => !r.tailOnly) : reasons;
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
 * Whole days a Case has been waiting on a reason's clock. Never negative; a
 * missing clock reads as 0.
 *
 * @param {CaseRow} caseRow
 * @param {Reason} reason
 * @param {Date} [now]
 * @returns {number}
 */
export function daysWaiting(caseRow, reason, now = new Date()) {
  const at = /** @type {string | null | undefined} */ (
    caseRow[reason.clockField]
  );
  if (!at) return 0;
  const diff = now.getTime() - new Date(at).getTime();
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

/**
 * The "waiting" chip for a Case in a reason group: its age, the reason-specific
 * label, and whether it has breached the reason's SLA (drives the urgent
 * styling and the "Needs action now" emphasis).
 *
 * @param {CaseRow} caseRow
 * @param {Reason} reason
 * @param {Date} [now]
 * @returns {{ days: number, label: string, breached: boolean }}
 */
export function waitingInfo(caseRow, reason, now = new Date()) {
  const days = daysWaiting(caseRow, reason, now);
  return {
    days,
    label: reason.waitingLabel(days),
    breached: days >= reason.slaDays,
  };
}

/**
 * The reason ids a Case row matches, by its hoisted flags, in priority order.
 * Used to pick a primary reason and note the rest inline ("also overdue").
 *
 * @param {CaseRow} caseRow
 * @returns {string[]}
 */
export function matchedReasonIds(caseRow) {
  return ACTION_CENTRE_REASONS.filter((r) => Boolean(caseRow[r.flagField])).map(
    (r) => r.id
  );
}

/**
 * The secondary reasons a Case qualifies for beyond the group it is shown in —
 * the inline "also …" note on a deduped row. Empty when the case only has the
 * one reason.
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
