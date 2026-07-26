// @ts-check
import { h } from '../../lib/html.js';
import { caseRouteFor } from '../../lib/case-route-links.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { caseActionsColumn } from '../../views/case-columns.js';
import { dataTableView } from '../../views/data-table.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */

/** @param {CaseRow} row */
export function openRemediationActions(row) {
  return Object.values(row.answers).flatMap((answer) =>
    (answer.remediationActions ?? []).filter((action) => !action.completed)
  );
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
      (row) => openRemediationActions(row).length > 0
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
      key: 'dueDate',
      label: 'Due Date',
      value: (row) => row.dueDate || '',
      sortable: true,
      format: (value) =>
        value ? new Date(String(value)).toLocaleDateString() : '—',
    },
    {
      key: 'action',
      label: 'Action required',
      value: (row) =>
        openRemediationActions(row)
          .map((action) => action.text)
          .join('; '),
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
  const today = now.toISOString();
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
        rowClass: (row) =>
          row.dueDate && row.dueDate < today
            ? 'cora-remediation-row cora-overdue'
            : 'cora-remediation-row',
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
