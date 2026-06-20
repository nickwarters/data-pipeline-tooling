// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { signal } from '../lib/signal.js';
import { h } from '../lib/html.js';
import { CRCaseTable } from '../components/cr-case-table.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @typedef {{
 *   totalCompleted: number,
 *   byOutcome: Record<string, number>,
 *   byMonth: Array<{ month: string, counts: Record<string, number> }>
 * }} OutcomeSummary
 */

export class CRResponsiblePartyDashboard extends ReactiveElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';

    /** @type {import('../lib/signal.js').Signal<CaseRow[]>} */
    this._myCases = signal([]);
    /** @type {import('../lib/signal.js').Signal<string>} */
    this._caseTypeFilterSignal = signal('');
  }

  async connectedCallback() {
    super.connectedCallback();
    if (!this.client || !this.currentUserId) return;
    const cases = await this.client.listCases({
      responsibleParty: this.currentUserId,
    });
    this._myCases.set(cases);
  }

  _computeDerived() {
    const cases = this._myCases.get();
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const cutoff = twelveMonthsAgo.toISOString();

    const recentCompleted = cases.filter(
      (c) =>
        c.status === 'Completed' &&
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

    const remediationCases = cases.filter((c) => this._hasOpenActions(c));
    const unreadCases = cases.filter((c) => this._hasUnreadMessages(c));

    return { outcomeSummary, remediationCases, unreadCases };
  }

  /** @param {string} caseType */
  _setCaseTypeFilter(caseType) {
    this._caseTypeFilterSignal.set(caseType);
  }

  get _outcomeSummary() {
    return this._computeDerived().outcomeSummary;
  }
  get _remediationCases() {
    return this._computeDerived().remediationCases;
  }
  get _unreadCases() {
    return this._computeDerived().unreadCases;
  }
  get _caseTypeFilter() {
    return this._caseTypeFilterSignal.get();
  }

  render() {
    if (!this.client || !this.currentUserId) return [];
    const derived = this._computeDerived();

    return [
      this._buildOutcomeSummary(derived.outcomeSummary),
      this._buildRemediationSection(derived.remediationCases),
      this._buildMessagesSection(derived.unreadCases),
    ];
  }

  /** @param {OutcomeSummary} summary */
  _buildOutcomeSummary(summary) {
    const statsChildren = [
      h('dt', {}, 'Completed Cases'),
      h(
        'dd',
        { className: 'cr-rp-outcome-total' },
        String(summary.totalCompleted)
      ),
    ];

    for (const [label, count] of Object.entries(summary.byOutcome)) {
      statsChildren.push(
        h('dt', {}, label),
        h(
          'dd',
          { className: `cr-rp-outcome-${label.toLowerCase()}` },
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
        { className: 'cr-rp-outcome-table' },
        h('thead', {}, h('tr', {}, ...theadChildren)),
        h('tbody', {}, ...tbodyChildren)
      );
    }

    return h(
      'section',
      { className: 'cr-rp-outcome-summary' },
      h('h2', {}, 'Outcome Summary (last 12 months)'),
      h('dl', { className: 'cr-rp-outcome-stats' }, ...statsChildren),
      table ? table : ''
    );
  }

  /** @param {CaseRow[]} remediationCases */
  _buildRemediationSection(remediationCases) {
    const caseTypes = [...new Set(remediationCases.map((c) => c.caseType))];
    const filter = this._caseTypeFilterSignal.get();

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
      { className: 'cr-rp-remediation' },
      h('h2', {}, 'Outstanding Remediation Actions'),
      h(
        'select',
        {
          className: 'cr-rp-remediation-filter',
          'aria-label': 'Filter by Case Type',
          onchange: (/** @type {any} */ e) =>
            this._setCaseTypeFilter(e.target?.value ?? ''),
          value: filter,
        },
        ...options
      ),
      h('cr-case-table', {
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
              this._getOpenActions(r)
                .map((ra) => ra.text)
                .join('; '),
          },
        ],
        rowClass: (/** @type {CaseRow} */ r) => {
          const overdue = !!r.dueDate && r.dueDate < now;
          return overdue
            ? 'cr-remediation-row cr-overdue'
            : 'cr-remediation-row';
        },
        cases: filteredCases,
      })
    );
  }

  /** @param {CaseRow[]} unreadCases */
  _buildMessagesSection(unreadCases) {
    return h(
      'section',
      { className: 'cr-rp-messages' },
      h('h2', {}, 'Cases with Unread Messages'),
      h('cr-case-table', {
        toolbar: 'hidden',
        sort: { key: 'lastMessage', dir: 'desc' },
        columns: [
          {
            key: 'reference',
            label: 'Reference',
            getValue: (/** @type {CaseRow} */ r) => r.title || r.id,
            renderCell: (/** @type {CaseRow} */ r) =>
              h('a', { href: `#/case/${r.id}` }, r.title || r.id),
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
                  className: 'cr-case-open-btn',
                  'aria-label': `Open ${r.title || r.id}`,
                  onclick: () => {
                    this.dispatchEvent(
                      new CustomEvent('cr-open-conversation', {
                        detail: { caseId: r.id },
                        bubbles: true,
                        composed: true,
                      })
                    );
                  },
                },
                'Open'
              );
            },
          },
        ],
        cases: unreadCases,
        'oncr-case-open': (/** @type {any} */ e) => {
          this.dispatchEvent(
            new CustomEvent('cr-open-conversation', {
              detail: { caseId: e.detail.caseId },
              bubbles: true,
            })
          );
        },
      })
    );
  }

  /** @param {CaseRow} c */
  _hasOpenActions(c) {
    for (const answer of Object.values(c.answers)) {
      if (answer.remediationActions?.some((ra) => !ra.completed)) return true;
    }
    return false;
  }

  /** @param {CaseRow} c @returns {Array<{id: string, text: string, completed: boolean}>} */
  _getOpenActions(c) {
    /** @type {Array<{id: string, text: string, completed: boolean}>} */
    const out = [];
    for (const answer of Object.values(c.answers)) {
      for (const ra of answer.remediationActions ?? []) {
        if (!ra.completed) out.push(ra);
      }
    }
    return out;
  }

  /** @param {CaseRow} c */
  _hasUnreadMessages(c) {
    const msgs = c.conversation;
    if (!msgs.length) return false;
    const rpMessages = msgs.filter((m) => m.author === this.currentUserId);
    const lastRpTime =
      rpMessages.length > 0
        ? rpMessages[rpMessages.length - 1].timestamp
        : null;
    return msgs.some(
      (m) =>
        m.author !== this.currentUserId &&
        (lastRpTime === null || m.timestamp > lastRpTime)
    );
  }
}

customElements.define(
  'cr-responsible-party-dashboard',
  CRResponsiblePartyDashboard
);
