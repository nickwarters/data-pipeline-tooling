// @ts-check
import { ShellElement } from '../lib/view.js';
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

/**
 * @param {{
 *   client: SharePointClient,
 *   ownedCaseTypes: string[],
 *   now?: Date
 * }} props
 * @returns {Promise<OwnerSummary[]>}
 */
export async function loadOwnerSummaries({ client, ownedCaseTypes, now }) {
  const currentTime = now ?? new Date();
  const todayStart = new Date(
    currentTime.getFullYear(),
    currentTime.getMonth(),
    currentTime.getDate()
  );
  const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const nowIso = currentTime.toISOString();
  const todayIso = todayStart.toISOString();
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();

  return Promise.all(
    ownedCaseTypes.map(async (caseType) => {
      const all = await client.listCases({ caseType });
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
}

/**
 * @param {{ summaries: OwnerSummary[] }} props
 * @returns {Node[]}
 */
export function OwnerSummary({ summaries }) {
  const h2 = h(
    'h2',
    { class: 'cora-owner-summary-heading' },
    'Case Type Ownership Summary'
  );

  const cards = summaries.map((s) => {
    /** @type {Array<{ label: string, value: number, className: string }>} */
    const stats = [
      {
        label: 'Outstanding',
        value: s.outstanding,
        className: 'cora-owner-outstanding',
      },
      {
        label: 'Assigned',
        value: s.assigned,
        className: 'cora-owner-assigned',
      },
      { label: 'Overdue', value: s.overdue, className: 'cora-owner-overdue' },
      {
        label: 'Completed today',
        value: s.completedToday,
        className: 'cora-owner-completed-today',
      },
      {
        label: 'Completed (last 7 days)',
        value: s.completedLast7Days,
        className: 'cora-owner-completed-7d',
      },
    ];

    return h(
      'div',
      { class: 'cora-owner-card' },
      h('h3', { class: 'cora-owner-card-title' }, s.caseType),
      h(
        'dl',
        { class: 'cora-owner-stats' },
        ...stats.flatMap(({ label, value, className }) => [
          h('dt', {}, label),
          h('dd', { class: className }, String(value)),
        ])
      )
    );
  });

  return [h2, ...cards];
}

export class CORAOwnerSummary extends ShellElement {
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
    this._summaries = await loadOwnerSummaries({
      client: /** @type {SharePointClient} */ (this.client),
      ownedCaseTypes: this.ownedCaseTypes,
    });

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
    return OwnerSummary({ summaries: this._summaries });
  }
}

customElements.define('cora-owner-summary', CORAOwnerSummary);
