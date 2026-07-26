// @ts-check
import { h } from '../../lib/html.js';
import { caseRouteFor } from '../../lib/case-route-links.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { isOverdue } from '../../evaluators/overdue-evaluator.js';
import {
  answerRemediation,
  isRemediationResolved,
} from '../../evaluators/remediation-status.js';
import { isReportable } from '../../services/section-access.js';
import { caseActionsColumn } from '../../views/case-columns.js';
import { dataTableView } from '../../views/data-table.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */

/**
 * What remediation is still outstanding on one Case, as the text of each thing
 * that has to be put right.
 *
 * Derived from the **one remediation model** (ADR-0037, ADR-0024's #497
 * amendment): the Remediation Actions and free-form text on each Answer, minus
 * every Answer the Assigned Reviewer has resolved on the Remediation tab. It
 * used to filter `action.completed`, a boolean written `false` on select and
 * never set `true` anywhere — so this count could never go down however much
 * remediation the Reviewer resolved (#497).
 *
 * Only *sent* remediation counts: before Send Actions the Reviewer is still
 * capturing, and nothing has been asked of the Responsible Party yet.
 *
 * @param {CaseRow} row
 * @returns {string[]}
 */
export function outstandingRemediation(row) {
  if (!isReportable(row.status)) return [];
  return Object.values(row.answers ?? {}).flatMap((answer) => {
    const remediation = answerRemediation(answer);
    if (!remediation || isRemediationResolved(answer.remediationStatus)) {
      return [];
    }
    const texts = remediation.actions.map((action) => action.text);
    if (remediation.freeForm) texts.push(remediation.freeForm);
    return texts;
  });
}

/** @param {CaseRow} row @param {string} currentUserId */
export function hasUnreadMessages(row, currentUserId) {
  if (row.conversation.length === 0) return false;
  const own = row.conversation.filter(
    (message) => message.author === currentUserId
  );
  const lastOwn = own.at(-1)?.timestamp ?? null;
  return row.conversation.some(
    (message) =>
      message.author !== currentUserId &&
      (lastOwn == null || message.timestamp > lastOwn)
  );
}

/**
 * @param {CaseRow[]} cases
 * @param {string} currentUserId
 * @param {Date} [now]
 */
export function deriveResponsibleParty(cases, currentUserId, now = new Date()) {
  const cutoffDate = new Date(now);
  cutoffDate.setMonth(cutoffDate.getMonth() - 12);
  const cutoff = cutoffDate.toISOString();
  const completed = cases.filter(
    (row) =>
      row.status === CASE_STATUS.COMPLETED &&
      row.completedAt != null &&
      row.completedAt >= cutoff
  );
  /** @type {Record<string, number>} */
  const byOutcome = {};
  /** @type {Record<string, Record<string, number>>} */
  const byMonth = {};
  for (const row of completed) {
    const outcome = row.outcome ?? 'Unknown';
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1;
    const month = /** @type {string} */ (row.completedAt).slice(0, 7);
    byMonth[month] ??= {};
    byMonth[month][outcome] = (byMonth[month][outcome] ?? 0) + 1;
  }
  return {
    outcomeSummary: {
      totalCompleted: completed.length,
      byOutcome,
      byMonth: Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, counts]) => ({ month, counts })),
    },
    remediationCases: cases.filter(
      (row) => outstandingRemediation(row).length > 0
    ),
    unreadCases: cases.filter((row) => hasUnreadMessages(row, currentUserId)),
  };
}

/** @param {ReturnType<typeof deriveResponsibleParty>['outcomeSummary']} summary */
function outcomeSummaryView(summary) {
  const outcomes = Object.keys(summary.byOutcome);
  return h(
    'section',
    { className: 'cora-rp-outcome-summary' },
    h('h2', {}, 'Outcome Summary (last 12 months)'),
    h(
      'dl',
      { className: 'cora-rp-outcome-stats' },
      h('dt', {}, 'Completed Cases'),
      h(
        'dd',
        { className: 'cora-rp-outcome-total' },
        String(summary.totalCompleted)
      ),
      ...outcomes.flatMap((outcome) => [
        h('dt', {}, outcome),
        h(
          'dd',
          { className: `cora-rp-outcome-${outcome.toLowerCase()}` },
          String(summary.byOutcome[outcome])
        ),
      ])
    ),
    outcomes.length
      ? h(
          'table',
          { className: 'cora-rp-outcome-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, 'Month'),
              ...outcomes.map((outcome) => h('th', { scope: 'col' }, outcome))
            )
          ),
          h(
            'tbody',
            {},
            ...summary.byMonth.map(({ month, counts }) =>
              h(
                'tr',
                {},
                h('td', {}, month),
                ...outcomes.map((outcome) =>
                  h('td', {}, String(counts[outcome] ?? 0))
                )
              )
            )
          )
        )
      : null
  );
}

/**
 * The deadline this table is about: the **case-level Remediation Due Date**,
 * stamped at Send Actions as `reportableAt` + 10 working days, and the clock the
 * Responsible Party actually works to. `dueDate` is the *review* SLA — the
 * Assigned Reviewer's clock — and dating remediation work by it was #498.
 *
 * The fallback is retained deliberately: every Case that passes Send Actions is
 * stamped, but a Case carried over from before that transition existed (or
 * closed before #502 taught the fork to see free-form remediation) can still
 * reach this table with only a review `dueDate`, and showing the wrong date
 * beats showing none.
 *
 * @param {CaseRow} row
 * @returns {string}
 */
function remediationDeadline(row) {
  return row.remediationDueDate || row.dueDate || '';
}

/** @returns {import('../../views/data-table.js').ColumnDescriptor<CaseRow>[]} */
function remediationColumns() {
  return [
    {
      key: 'reference',
      label: 'Reference',
      value: (row) => row.title || row.id,
    },
    { key: 'caseType', label: 'Case Type', value: 'caseType' },
    {
      key: 'remediationDueDate',
      label: 'Remediation due',
      value: remediationDeadline,
      sortable: true,
      format: (value) =>
        value ? new Date(String(value)).toLocaleDateString() : '—',
    },
    {
      key: 'action',
      label: 'Action required',
      value: (row) => outstandingRemediation(row).join('; '),
    },
  ];
}

/** @returns {import('../../views/data-table.js').ColumnDescriptor<CaseRow>[]} */
function messageColumns(
  /** @type {((row: CaseRow) => void) | undefined} */ onOpenConversation
) {
  return [
    {
      key: 'reference',
      label: 'Reference',
      value: (row) => row.title || row.id,
      href: caseRouteFor,
    },
    { key: 'caseType', label: 'Case Type', value: 'caseType' },
    {
      key: 'lastMessage',
      label: 'Last message',
      value: (row) => row.conversation.at(-1)?.timestamp ?? null,
      sortable: true,
      format: (value) =>
        value ? new Date(String(value)).toLocaleString() : '—',
    },
    caseActionsColumn((row) => onOpenConversation?.(row)),
  ];
}

/**
 * @param {{
 *   cases: CaseRow[], currentUserId: string, filter: string,
 *   remediationSort: import('../../views/data-table.js').TableSort | null,
 *   messageSort: import('../../views/data-table.js').TableSort | null,
 * }} state
 * @param {{
 *   onFilterChange: (value: string) => void,
 *   onRemediationSort: (key: string) => void,
 *   onMessageSort: (key: string) => void,
 *   onOpenConversation?: (row: CaseRow) => void,
 * }} handlers
 * @param {Date} [now]
 */
export function responsiblePartyView(state, handlers, now = new Date()) {
  const derived = deriveResponsibleParty(state.cases, state.currentUserId, now);
  const caseTypes = [
    ...new Set(derived.remediationCases.map((row) => row.caseType)),
  ];
  const remediationCases = state.filter
    ? derived.remediationCases.filter((row) => row.caseType === state.filter)
    : derived.remediationCases;
  return h(
    'div',
    { className: 'cora-responsible-party-dashboard' },
    outcomeSummaryView(derived.outcomeSummary),
    h(
      'section',
      { className: 'cora-rp-remediation' },
      h('h2', {}, 'Outstanding Remediation Actions'),
      h(
        'select',
        {
          className: 'cora-rp-remediation-filter',
          'aria-label': 'Filter by Case Type',
          value: state.filter,
          onchange: (/** @type {any} */ event) =>
            handlers.onFilterChange(event.target?.value ?? ''),
        },
        h('option', { value: '' }, 'All Case Types'),
        ...caseTypes.map((caseType) =>
          h('option', { value: caseType }, caseType)
        )
      ),
      dataTableView({
        rows: remediationCases,
        columns: remediationColumns(),
        sort: state.remediationSort,
        onSort: handlers.onRemediationSort,
        emptyMessage: 'No outstanding remediation actions.',
        rowKey: (row) => `${row.caseType}:${row.id}`,
        // Overdue against the *remediation* clock, exactly as the Remediation
        // tab badges it — `isOverdue` reads `dueDate`, so the deadline this
        // table is about is substituted in (#498).
        rowClass: (row) => {
          const dueDate = remediationDeadline(row);
          return dueDate && isOverdue({ ...row, dueDate }, undefined, now)
            ? 'cora-remediation-row cora-overdue'
            : 'cora-remediation-row';
        },
      })
    ),
    h(
      'section',
      { className: 'cora-rp-messages' },
      h('h2', {}, 'Cases with Unread Messages'),
      dataTableView({
        rows: derived.unreadCases,
        columns: messageColumns(handlers.onOpenConversation),
        sort: state.messageSort,
        onSort: handlers.onMessageSort,
        emptyMessage: 'No cases with unread messages.',
        rowKey: (row) => `${row.caseType}:${row.id}`,
        rowHref: caseRouteFor,
      })
    )
  );
}
