// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @typedef {{
 *   caseType: string,
 *   outstanding: number,
 *   assigned: number,
 *   overdue: number,
 *   completedToday: number,
 *   completedLast7Days: number
 * }} OwnerSummary
 */

export class CROwnerSummary extends ReactiveElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string[]} */
    this.ownedCaseTypes = [];
    /** @type {OwnerSummary[]} */
    this._summaries = [];
  }

  async connectedCallback() {
    super.connectedCallback();
    if (!this.client || !this.ownedCaseTypes.length) return;
    await this._refresh();
  }

  async _refresh() {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const sevenDaysAgo = new Date(
      todayStart.getTime() - 7 * 24 * 60 * 60 * 1000
    );
    const nowIso = now.toISOString();
    const todayIso = todayStart.toISOString();
    const sevenDaysAgoIso = sevenDaysAgo.toISOString();

    this._summaries = await Promise.all(
      this.ownedCaseTypes.map(async (caseType) => {
        const all = await /** @type {SharePointClient} */ (
          this.client
        ).listCases({ caseType });
        const inProgress = all.filter((c) => c.status === 'In-progress');
        const completed = all.filter((c) => c.status === 'Completed');

        return {
          caseType,
          outstanding: inProgress.filter((c) => !c.assignedReviewer).length,
          assigned: inProgress.filter((c) => !!c.assignedReviewer).length,
          overdue: inProgress.filter(
            (c) => !!c.dueDate && /** @type {string} */ (c.dueDate) < nowIso
          ).length,
          completedToday: completed.filter(
            (c) => !!c.completedAt && c.completedAt >= todayIso
          ).length,
          completedLast7Days: completed.filter(
            (c) => !!c.completedAt && c.completedAt >= sevenDaysAgoIso
          ).length,
        };
      })
    );

    this._render();
  }

  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (Array.isArray(content)) this.replaceChildren(...content);
      else this.replaceChildren(content);
    }
  }

  render() {
    if (!this.client || !this.ownedCaseTypes.length) return undefined;

    const h2 = h(
      'h2',
      { class: 'cr-owner-summary-heading' },
      'Case Type Ownership Summary'
    );

    const cards = this._summaries.map((s) => {
      /** @type {Array<{ label: string, value: number, className: string }>} */
      const stats = [
        {
          label: 'Outstanding',
          value: s.outstanding,
          className: 'cr-owner-outstanding',
        },
        {
          label: 'Assigned',
          value: s.assigned,
          className: 'cr-owner-assigned',
        },
        { label: 'Overdue', value: s.overdue, className: 'cr-owner-overdue' },
        {
          label: 'Completed today',
          value: s.completedToday,
          className: 'cr-owner-completed-today',
        },
        {
          label: 'Completed (last 7 days)',
          value: s.completedLast7Days,
          className: 'cr-owner-completed-7d',
        },
      ];

      return h(
        'div',
        { class: 'cr-owner-card' },
        h('h3', { class: 'cr-owner-card-title' }, s.caseType),
        h(
          'dl',
          { class: 'cr-owner-stats' },
          ...stats.flatMap(({ label, value, className }) => [
            h('dt', {}, label),
            h('dd', { class: className }, String(value)),
          ])
        )
      );
    });

    return [h2, ...cards];
  }
}

customElements.define('cr-owner-summary', CROwnerSummary);
