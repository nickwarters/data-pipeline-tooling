// @ts-check
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';
import { h } from '../lib/html.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import '../components/collections/cora-case-table.js';
import { CASE_STATUS } from '../lib/case-statuses.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @typedef {{
 * totalCompleted: number,
 * byOutcome: Record<string, number>,
 * byMonth: Array<{ month: string, counts: Record<string, number> }>
 * }} OutcomeSummary
 */

/**
 * Responsible-party landing dashboard: outcome summary for completed cases,
 * outstanding remediation actions, and cases with unread reviewer messages.
 *
 * @param {{
 * client: SharePointClient | null,
 * currentUserId: string,
 * allCaseSources?: import('../setup/resolve-eligible-case-types.js').CaseSource[],
 * onOpenConversation?: (caseRow: CaseRow) => void,
 * }} props
 * @returns {HTMLElement}
 */
export function ResponsiblePartyDashboard({
  client,
  currentUserId,
  allCaseSources = [],
  onOpenConversation,
}) {
  /** @type {import('../lib/signal.js').Signal<CaseRow[]>} */
  const myCases = signal(/** @type {CaseRow[]} */ ([]));
  /** @type {import('../lib/signal.js').Signal<string>} */
  const caseTypeFilter = signal('');

  async function fetchData() {
    if (!client || !currentUserId) return;
    // Each source is a distinct list; fan out and flatten rather than
    // fetching unscoped and filtering in JS — there is no default Case
    // list, and a Case lives in exactly one list, so per-list pools simply
    // merge together.
    const fetched = await Promise.all(
      allCaseSources.map((source) =>
        /** @type {SharePointClient} */ (client).listCases(
          { responsibleParty: currentUserId },
          { listName: source.listName }
        )
      )
    );
    myCases.set(fetched.flat());
  }

  const host = reactive(() => {
    if (!client || !currentUserId) return [];
    const derived = computeDerived(myCases.get(), currentUserId);

    return [
      buildOutcomeSummary(derived.outcomeSummary),
      buildRemediationSection(derived.remediationCases, {
        filter: caseTypeFilter.get(),
        onFilterChange: (value) => caseTypeFilter.set(value),
      }),
      buildMessagesSection(derived.unreadCases, onOpenConversation),
    ];
  });

  fetchData();
  return host;
}

/**
 * @param {CaseRow[]} cases
 * @param {string} currentUserId
 * @returns {{ outcomeSummary: OutcomeSummary, remediationCases: CaseRow[], unreadCases: CaseRow[] }}
 */
function computeDerived(cases, currentUserId) {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const cutoff = twelveMonthsAgo.toISOString();

  const recentCompleted = cases.filter(
    (c) =>
      c.status === CASE_STATUS.COMPLETED &&
      c.completedAt != null &&
      /** @type {string} */ (c.completedAt) >= cutoff
  );

  /** @type {Record<string, number>} */
  const byOutcome = {};
  /** @type {Record<string, Record<string, number>>} */
  const monthMap = {};

  for (const c of recentCompleted) {
    const label = c.outcome ?? 'Unknown';
    byOutcome[label] = (byOutcome[label] ?? 0) + 1;
    const month = /** @type {string} */ (c.completedAt).slice(0, 7); // YYYY-MM
    if (!monthMap[month]) monthMap[month] = {};
    monthMap[month][label] = (monthMap[month][label] ?? 0) + 1;
  }

  const outcomeSummary = {
    totalCompleted: recentCompleted.length,
    byOutcome,
    byMonth: Object.entries(monthMap)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, counts]) => ({ month, counts })),
  };

  const remediationCases = cases.filter((/** @type {CaseRow} */ c) =>
    hasOpenActions(c)
  );
  const unreadCases = cases.filter((/** @type {CaseRow} */ c) =>
    hasUnreadMessages(c, currentUserId)
  );

  return { outcomeSummary, remediationCases, unreadCases };
}

/** @param {OutcomeSummary} summary */
function buildOutcomeSummary(summary) {
  const statsChildren = [
    h('dt', {}, 'Completed Cases'),
    h(
      'dd',
      { className: 'cora-rp-outcome-total' },
      String(summary.totalCompleted)
    ),
  ];

  for (const [label, count] of Object.entries(summary.byOutcome)) {
    statsChildren.push(
      h('dt', {}, label),
      h(
        'dd',
        { className: `cora-rp-outcome-${label.toLowerCase()}` },
        String(count)
      )
    );
  }

  const allOutcomes = Object.keys(summary.byOutcome);
  let table = null;

  if (allOutcomes.length > 0) {
    const theadChildren = [
      h('th', { scope: 'col' }, 'Month'),
      ...allOutcomes.map((label) => h('th', { scope: 'col' }, label)),
    ];

    const tbodyChildren = summary.byMonth.map(({ month, counts }) => {
      return h(
        'tr',
        {},
        h('td', {}, month),
        ...allOutcomes.map((label) => h('td', {}, String(counts[label] ?? 0)))
      );
    });

    table = h(
      'table',
      { className: 'cora-rp-outcome-table' },
      h('thead', {}, h('tr', {}, ...theadChildren)),
      h('tbody', {}, ...tbodyChildren)
    );
  }

  return h(
    'section',
    { className: 'cora-rp-outcome-summary' },
    h('h2', {}, 'Outcome Summary (last 12 months)'),
    h('dl', { className: 'cora-rp-outcome-stats' }, ...statsChildren),
    table ? table : ''
  );
}

/**
 * @param {CaseRow[]} remediationCases
 * @param {{ filter: string, onFilterChange: (value: string) => void }} filterState
 */
function buildRemediationSection(remediationCases, { filter, onFilterChange }) {
  const caseTypes = [...new Set(remediationCases.map((c) => c.caseType))];

  const options = [
    h('option', { value: '' }, 'All Case Types'),
    ...caseTypes.map((ct) => h('option', { value: ct }, ct)),
  ];

  const filteredCases = filter
    ? remediationCases.filter((c) => c.caseType === filter)
    : remediationCases;

  const now = new Date().toISOString();

  return h(
    'section',
    { className: 'cora-rp-remediation' },
    h('h2', {}, 'Outstanding Remediation Actions'),
    h(
      'select',
      {
        className: 'cora-rp-remediation-filter',
        'aria-label': 'Filter by Case Type',
        onchange: (/** @type {any} */ e) =>
          onFilterChange(e.target?.value ?? ''),
        value: filter,
      },
      ...options
    ),
    h('cora-case-table', {
      toolbar: 'hidden',
      sort: { key: 'dueDate', dir: 'asc' },
      columns: [
        {
          key: 'reference',
          label: 'Reference',
          getValue: (/** @type {CaseRow} */ r) => r.title || r.id,
        },
        {
          key: 'caseType',
          label: 'Case Type',
          getValue: (/** @type {CaseRow} */ r) => r.caseType,
        },
        {
          key: 'dueDate',
          label: 'Due Date',
          sortable: true,
          getValue: (/** @type {CaseRow} */ r) => r.dueDate || null,
          renderCell: (/** @type {CaseRow} */ r) =>
            r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '—',
        },
        {
          key: 'action',
          label: 'Action required',
          getValue: (/** @type {CaseRow} */ r) =>
            getOpenActions(r)
              .map((ra) => ra.text)
              .join('; '),
        },
      ],
      rowClass: (/** @type {CaseRow} */ r) => {
        const overdue = !!r.dueDate && r.dueDate < now;
        return overdue
          ? 'cora-remediation-row cora-overdue'
          : 'cora-remediation-row';
      },
      cases: filteredCases,
    })
  );
}

/**
 * @param {CaseRow[]} unreadCases
 * @param {((caseRow: CaseRow) => void) | undefined} onOpenConversation
 */
function buildMessagesSection(unreadCases, onOpenConversation) {
  return h(
    'section',
    { className: 'cora-rp-messages' },
    h('h2', {}, 'Cases with Unread Messages'),
    h('cora-case-table', {
      toolbar: 'hidden',
      sort: { key: 'lastMessage', dir: 'desc' },
      columns: [
        {
          key: 'reference',
          label: 'Reference',
          getValue: (/** @type {CaseRow} */ r) => r.title || r.id,
          renderCell: (/** @type {CaseRow} */ r) =>
            h('a', { href: caseRouteFor(r) }, r.title || r.id),
        },
        {
          key: 'caseType',
          label: 'Case Type',
          getValue: (/** @type {CaseRow} */ r) => r.caseType,
        },
        {
          key: 'lastMessage',
          label: 'Last message',
          sortable: true,
          getValue: (/** @type {CaseRow} */ r) =>
            r.conversation.at(-1)?.timestamp ?? null,
          renderCell: (/** @type {CaseRow} */ r) => {
            const ts = r.conversation.at(-1)?.timestamp;
            return ts ? new Date(ts).toLocaleString() : '—';
          },
        },
        {
          key: 'actions',
          label: 'Actions',
          renderCell: (/** @type {CaseRow} */ r) => {
            return h(
              'button',
              {
                type: 'button',
                className: 'cora-case-open-btn',
                'aria-label': `Open ${r.title || r.id}`,
                onclick: () => onOpenConversation?.(r),
              },
              'Open'
            );
          },
        },
      ],
      cases: unreadCases,
      'oncora-case-open': (/** @type {any} */ e) => {
        onOpenConversation?.(e.detail.caseRow);
      },
    })
  );
}

/** @param {CaseRow} c */
function hasOpenActions(c) {
  for (const answer of Object.values(c.answers)) {
    if (answer.remediationActions?.some((ra) => !ra.completed)) return true;
  }
  return false;
}

/** @param {CaseRow} c @returns {Array<{id: string, text: string, completed: boolean}>} */
function getOpenActions(c) {
  /** @type {Array<{id: string, text: string, completed: boolean}>} */
  const out = [];
  for (const answer of Object.values(c.answers)) {
    for (const ra of answer.remediationActions ?? []) {
      if (!ra.completed) out.push(ra);
    }
  }
  return out;
}

/** @param {CaseRow} c @param {string} currentUserId */
function hasUnreadMessages(c, currentUserId) {
  const msgs = c.conversation;
  if (!msgs.length) return false;
  const rpMessages = msgs.filter((m) => m.author === currentUserId);
  const lastRpTime =
    rpMessages.length > 0 ? rpMessages[rpMessages.length - 1].timestamp : null;
  return msgs.some(
    (m) =>
      m.author !== currentUserId &&
      (lastRpTime === null || m.timestamp > lastRpTime)
  );
}
