// @ts-check
import { CRElement } from '../components/cr-element.js';
import { fetchReviewerTeamCases } from '../services/reviewer-team-fetcher.js';
import { aggregateReviewerTeamData } from '../evaluators/reviewer-team-aggregator.js';
import { computeTimeWindows } from '../evaluators/time-windows.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */

export class CRReviewerTeamReport extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient|null} */
    this.client = null;
    /** @type {CurrentUser|null} */
    this.currentUser = null;
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
  }

  async connectedCallback() {
    const h1 = document.createElement('h1');
    h1.textContent = 'Reviewer Team Performance';

    const back = document.createElement('a');
    back.setAttribute('href', '#/reports');
    back.textContent = '← Back to Reports';

    if (!this.client || !this.currentUser) {
      this.replaceChildren(h1, back);
      return;
    }

    const cases = await fetchReviewerTeamCases(this.client, this.currentUser.id, this.eligibleCaseTypes);
    const windows = computeTimeWindows(new Date());
    const data = aggregateReviewerTeamData(cases, windows);

    const kpiSection = this._renderKpiSection(data);
    const breakdownSection = this._renderBreakdownSection(data);

    this.replaceChildren(h1, back, kpiSection, breakdownSection);
  }

  /**
   * @param {import('../evaluators/reviewer-team-aggregator.js').AggregateResult} data
   */
  _renderKpiSection(data) {
    const section = document.createElement('div');
    section.className = 'cr-kpi-section';

    const tiles = [
      { label: 'Completed (last 7 days)', value: data.completedLast7d, filter: 'completed-7d' },
      { label: 'Completed (last 30 days)', value: data.completedLast30d, filter: 'completed-30d' },
      { label: 'Outstanding', value: data.outstanding, filter: 'outstanding' },
      { label: 'Overdue', value: data.overdue, filter: 'overdue' },
    ];

    for (const { label, value, filter } of tiles) {
      const tile = document.createElement('div');
      tile.className = 'cr-kpi-tile';

      const count = document.createElement('a');
      count.setAttribute('href', `#/team-cases?manager=me&filter=${filter}`);
      count.textContent = String(value);

      const lbl = document.createElement('span');
      lbl.textContent = label;

      tile.appendChild(count);
      tile.appendChild(lbl);
      section.appendChild(tile);
    }

    return section;
  }

  /**
   * @param {import('../evaluators/reviewer-team-aggregator.js').AggregateResult} data
   */
  _renderBreakdownSection(data) {
    const section = document.createElement('div');
    section.className = 'cr-breakdown-section';

    for (const [caseType, counts] of Object.entries(data.byType)) {
      const row = document.createElement('div');
      row.className = 'cr-breakdown-row';

      const name = document.createElement('span');
      name.textContent = caseType;
      row.appendChild(name);

      const cells = [
        { value: counts.completedLast7d, filter: 'completed-7d' },
        { value: counts.completedLast30d, filter: 'completed-30d' },
        { value: counts.outstanding, filter: 'outstanding' },
        { value: counts.overdue, filter: 'overdue' },
      ];

      for (const { value, filter } of cells) {
        const cell = document.createElement('a');
        cell.setAttribute('href', `#/team-cases?manager=me&caseType=${caseType}&filter=${filter}`);
        cell.textContent = String(value);
        row.appendChild(cell);
      }

      section.appendChild(row);
    }

    return section;
  }
}

customElements.define('cr-reviewer-team-report', CRReviewerTeamReport);
