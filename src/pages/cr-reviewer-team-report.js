// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { signal } from '../lib/signal.js';
import { h } from '../lib/html.js';
import { fetchReviewerTeamCases } from '../services/reviewer-team-fetcher.js';
import { aggregateReviewerTeamData } from '../evaluators/reviewer-team-aggregator.js';
import { computeTimeWindows } from '../evaluators/time-windows.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */

export class CRReviewerTeamReport extends ReactiveElement {
  constructor() {
    super();
    /** @type {SharePointClient|null} */
    this.client = null;
    /** @type {CurrentUser|null} */
    this.currentUser = null;
    /** @type {string[]} */
    this.eligibleCaseTypes = [];

    /** @type {import('../lib/signal.js').Signal<import('../evaluators/reviewer-team-aggregator.js').AggregateResult | null>} */
    this._data = signal(/** @type {import('../evaluators/reviewer-team-aggregator.js').AggregateResult | null} */ (null));
    /** @type {import('../lib/signal.js').Signal<import('../evaluators/time-windows.js').TimeWindows | null>} */
    this._windows = signal(/** @type {import('../evaluators/time-windows.js').TimeWindows | null} */ (null));
  }

  async connectedCallback() {
    super.connectedCallback();
    await this._fetchData();
  }

  async _fetchData() {
    if (!this.client || !this.currentUser) return;
    const cases = await fetchReviewerTeamCases(
      this.client,
      this.currentUser.id,
      this.eligibleCaseTypes
    );
    const windows = computeTimeWindows(new Date());
    this._windows.set(windows);
    this._data.set(aggregateReviewerTeamData(cases, windows));
  }

  render() {
    const h1 = h('h1', {}, 'Reviewer Team Performance');
    const back = h('a', { href: '#/reports' }, '← Back to Reports');

    const data = this._data.get();
    const windows = this._windows.get();

    if (!data || !windows) {
      return [h1, back];
    }

    return [
      h1,
      back,
      this._renderKpiSection(data, windows),
      this._renderBreakdownSection(data, windows),
    ];
  }

  /**
   * @param {import('../evaluators/reviewer-team-aggregator.js').AggregateResult} data
   * @param {import('../evaluators/time-windows.js').TimeWindows} windows
   */
  _renderKpiSection(data, windows) {
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
      { className: 'cr-kpi-section' },
      ...tiles.map((t) =>
        h(
          'div',
          { className: 'cr-kpi-tile' },
          h('a', { href: t.href }, String(t.value)),
          h('span', {}, t.label)
        )
      )
    );
  }

  /**
   * @param {import('../evaluators/reviewer-team-aggregator.js').AggregateResult} data
   * @param {import('../evaluators/time-windows.js').TimeWindows} windows
   */
  _renderBreakdownSection(data, windows) {
    const since7 = windows.sevenDaysAgo.toISOString().slice(0, 10);
    const since30 = windows.thirtyDaysAgo.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    return h(
      'div',
      { className: 'cr-breakdown-section' },
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
          { className: 'cr-breakdown-row' },
          h('span', {}, caseType),
          ...cells.map((c) => h('a', { href: c.href }, String(c.value)))
        );
      })
    );
  }
}

customElements.define('cr-reviewer-team-report', CRReviewerTeamReport);
