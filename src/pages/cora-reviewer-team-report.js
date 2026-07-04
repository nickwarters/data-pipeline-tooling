// @ts-check
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';
import { h } from '../lib/html.js';
import { fetchReviewerTeamCases } from '../services/reviewer-team-fetcher.js';
import { aggregateReviewerTeamData } from '../evaluators/reviewer-team-aggregator.js';
import { computeTimeWindows } from '../evaluators/time-windows.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */

/**
 * @param {{
 *   client: SharePointClient | null,
 *   currentUser: CurrentUser | null,
 *   eligibleCaseTypes: string[],
 * }} props
 * @returns {HTMLElement}
 */
export function ReviewerTeamReportPage({
  client,
  currentUser,
  eligibleCaseTypes,
}) {
  /** @type {import('../lib/signal.js').Signal<import('../evaluators/reviewer-team-aggregator.js').AggregateResult | null>} */
  const data = signal(
    /** @type {import('../evaluators/reviewer-team-aggregator.js').AggregateResult | null} */ (
      null
    )
  );
  /** @type {import('../lib/signal.js').Signal<import('../evaluators/time-windows.js').TimeWindows | null>} */
  const windows = signal(
    /** @type {import('../evaluators/time-windows.js').TimeWindows | null} */ (
      null
    )
  );

  async function fetchData() {
    if (!client || !currentUser) return;
    const cases = await fetchReviewerTeamCases(
      client,
      currentUser.id,
      eligibleCaseTypes
    );
    const computedWindows = computeTimeWindows(new Date());
    windows.set(computedWindows);
    data.set(aggregateReviewerTeamData(cases, computedWindows));
  }

  const host = reactive(() =>
    renderReviewerTeamReport({ data: data.get(), windows: windows.get() })
  );
  fetchData();
  return host;
}

/**
 * @param {{
 *   data: import('../evaluators/reviewer-team-aggregator.js').AggregateResult | null,
 *   windows: import('../evaluators/time-windows.js').TimeWindows | null,
 * }} args
 * @returns {Node[]}
 */
function renderReviewerTeamReport({ data, windows }) {
  const h1 = h('h1', {}, 'Reviewer Team Performance');
  const back = h('a', { href: '#/reports' }, '← Back to Reports');

  if (!data || !windows) {
    return [h1, back];
  }

  return [
    h1,
    back,
    renderKpiSection(data, windows),
    renderBreakdownSection(data, windows),
  ];
}

/**
 * @param {import('../evaluators/reviewer-team-aggregator.js').AggregateResult} data
 * @param {import('../evaluators/time-windows.js').TimeWindows} windows
 * @returns {Node}
 */
function renderKpiSection(data, windows) {
  const since7 = windows.sevenDaysAgo.toISOString().slice(0, 10);
  const since30 = windows.thirtyDaysAgo.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const tiles = [
    {
      label: 'Completed (last 7 days)',
      value: data.completedLast7d,
      href: `#/team-cases?manager=me&role=reviewer-manager&status=completed&completedSince=${since7}&completedUntil=${today}`,
    },
    {
      label: 'Completed (last 30 days)',
      value: data.completedLast30d,
      href: `#/team-cases?manager=me&role=reviewer-manager&status=completed&completedSince=${since30}&completedUntil=${today}`,
    },
    {
      label: 'Outstanding',
      value: data.outstanding,
      href: `#/team-cases?manager=me&role=reviewer-manager&status=outstanding`,
    },
    {
      label: 'Overdue',
      value: data.overdue,
      href: `#/team-cases?manager=me&role=reviewer-manager&status=overdue`,
    },
  ];

  return h(
    'div',
    { className: 'cora-kpi-section' },
    ...tiles.map((t) =>
      h(
        'div',
        { className: 'cora-kpi-tile' },
        h('a', { href: t.href }, String(t.value)),
        h('span', {}, t.label)
      )
    )
  );
}

/**
 * @param {import('../evaluators/reviewer-team-aggregator.js').AggregateResult} data
 * @param {import('../evaluators/time-windows.js').TimeWindows} windows
 * @returns {Node}
 */
function renderBreakdownSection(data, windows) {
  const since7 = windows.sevenDaysAgo.toISOString().slice(0, 10);
  const since30 = windows.thirtyDaysAgo.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  return h(
    'div',
    { className: 'cora-breakdown-section' },
    ...Object.entries(data.byType).map(([caseType, counts]) => {
      const cells = [
        {
          value: counts.completedLast7d,
          href: `#/team-cases?manager=me&role=reviewer-manager&caseType=${caseType}&status=completed&completedSince=${since7}&completedUntil=${today}`,
        },
        {
          value: counts.completedLast30d,
          href: `#/team-cases?manager=me&role=reviewer-manager&caseType=${caseType}&status=completed&completedSince=${since30}&completedUntil=${today}`,
        },
        {
          value: counts.outstanding,
          href: `#/team-cases?manager=me&role=reviewer-manager&caseType=${caseType}&status=outstanding`,
        },
        {
          value: counts.overdue,
          href: `#/team-cases?manager=me&role=reviewer-manager&caseType=${caseType}&status=overdue`,
        },
      ];

      return h(
        'div',
        { className: 'cora-breakdown-row' },
        h('span', {}, caseType),
        ...cells.map((c) => h('a', { href: c.href }, String(c.value)))
      );
    })
  );
}
