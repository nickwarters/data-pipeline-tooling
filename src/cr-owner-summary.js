// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('./sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./sharepoint-client.js').CaseRow} CaseRow */

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

export class CROwnerSummary extends CRElement {
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
    if (!this.client || !this.ownedCaseTypes.length) return;
    await this._refresh();
  }

  async _refresh() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const nowIso = now.toISOString();
    const todayIso = todayStart.toISOString();
    const sevenDaysAgoIso = sevenDaysAgo.toISOString();

    this._summaries = await Promise.all(
      this.ownedCaseTypes.map(async (caseType) => {
        const all = await /** @type {SharePointClient} */ (this.client).listCases({ caseType });
        const inProgress = all.filter(c => c.status === 'In-progress');
        const completed = all.filter(c => c.status === 'Completed');

        return {
          caseType,
          outstanding: inProgress.filter(c => !c.assignedReviewer).length,
          assigned: inProgress.filter(c => !!c.assignedReviewer).length,
          overdue: inProgress.filter(c => !!c.dueDate && /** @type {string} */ (c.dueDate) < nowIso).length,
          completedToday: completed.filter(c => !!c.completedAt && c.completedAt >= todayIso).length,
          completedLast7Days: completed.filter(c => !!c.completedAt && c.completedAt >= sevenDaysAgoIso).length,
        };
      })
    );

    this._renderSummaries(this._summaries);
  }

  /** @param {OwnerSummary[]} summaries */
  _renderSummaries(summaries) {
    const h2 = document.createElement('h2');
    h2.className = 'cr-owner-summary-heading';
    h2.textContent = 'Case Type Ownership Summary';

    const cards = summaries.map(s => {
      const card = document.createElement('div');
      card.className = 'cr-owner-card';

      const heading = document.createElement('h3');
      heading.className = 'cr-owner-card-title';
      heading.textContent = s.caseType;

      const dl = document.createElement('dl');
      dl.className = 'cr-owner-stats';

      /** @type {Array<{ label: string, value: number, className: string }>} */
      const stats = [
        { label: 'Outstanding', value: s.outstanding, className: 'cr-owner-outstanding' },
        { label: 'Assigned', value: s.assigned, className: 'cr-owner-assigned' },
        { label: 'Overdue', value: s.overdue, className: 'cr-owner-overdue' },
        { label: 'Completed today', value: s.completedToday, className: 'cr-owner-completed-today' },
        { label: 'Completed (last 7 days)', value: s.completedLast7Days, className: 'cr-owner-completed-7d' },
      ];

      for (const { label, value, className } of stats) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.className = className;
        dd.textContent = String(value);
        dl.appendChild(dt);
        dl.appendChild(dd);
      }

      card.replaceChildren(heading, dl);
      return card;
    });

    this.replaceChildren(h2, ...cards);
  }
}

customElements.define('cr-owner-summary', CROwnerSummary);
