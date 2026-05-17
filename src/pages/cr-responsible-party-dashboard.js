// @ts-check
import { CRElement } from '../components/cr-element.js';
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

export class CRResponsiblePartyDashboard extends CRElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {CaseRow[]} */
    this._myCases = [];
    /** @type {OutcomeSummary} */
    this._outcomeSummary = { totalCompleted: 0, byOutcome: {}, byMonth: [] };
    /** @type {CaseRow[]} */
    this._remediationCases = [];
    /** @type {CaseRow[]} */
    this._unreadCases = [];
    /** @type {string} */
    this._caseTypeFilter = '';
    /** @type {CRCaseTable | null} */
    this._remediationTable = null;
  }

  async connectedCallback() {
    if (!this.client || !this.currentUserId) return;
    this._myCases = await this.client.listCases({ responsibleParty: this.currentUserId });
    this._computeDerived();
    this._render();
  }

  _computeDerived() {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const cutoff = twelveMonthsAgo.toISOString();

    const recentCompleted = this._myCases.filter(c =>
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

    this._outcomeSummary = {
      totalCompleted: recentCompleted.length,
      byOutcome,
      byMonth: Object.entries(monthMap)
        .sort(([a], [b]) => a < b ? -1 : 1)
        .map(([month, counts]) => ({ month, counts })),
    };

    this._remediationCases = this._myCases.filter(c => this._hasOpenActions(c));
    this._unreadCases = this._myCases.filter(c => this._hasUnreadMessages(c));
  }

  /** @param {string} caseType */
  _setCaseTypeFilter(caseType) {
    this._caseTypeFilter = caseType;
    this._render();
  }

  _render() {
    this.replaceChildren(
      /** @type {any} */ (this._buildOutcomeSummary()),
      /** @type {any} */ (this._buildRemediationSection()),
      /** @type {any} */ (this._buildMessagesSection()),
    );
  }

  _buildOutcomeSummary() {
    const section = document.createElement('section');
    section.className = 'cr-rp-outcome-summary';

    const h2 = document.createElement('h2');
    h2.textContent = 'Outcome Summary (last 12 months)';

    const stats = document.createElement('dl');
    stats.className = 'cr-rp-outcome-stats';

    const dtTotal = document.createElement('dt');
    dtTotal.textContent = 'Completed Cases';
    const ddTotal = document.createElement('dd');
    ddTotal.className = 'cr-rp-outcome-total';
    ddTotal.textContent = String(this._outcomeSummary.totalCompleted);
    stats.appendChild(/** @type {any} */ (dtTotal));
    stats.appendChild(/** @type {any} */ (ddTotal));

    for (const [label, count] of Object.entries(this._outcomeSummary.byOutcome)) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.className = `cr-rp-outcome-${label.toLowerCase()}`;
      dd.textContent = String(count);
      stats.appendChild(/** @type {any} */ (dt));
      stats.appendChild(/** @type {any} */ (dd));
    }

    // Monthly breakdown table
    const table = document.createElement('table');
    table.className = 'cr-rp-outcome-table';

    const allOutcomes = Object.keys(this._outcomeSummary.byOutcome);
    if (allOutcomes.length > 0) {
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      const thMonth = document.createElement('th');
      thMonth.setAttribute('scope', 'col');
      thMonth.textContent = 'Month';
      headRow.appendChild(/** @type {any} */ (thMonth));
      for (const label of allOutcomes) {
        const th = document.createElement('th');
        th.setAttribute('scope', 'col');
        th.textContent = label;
        headRow.appendChild(/** @type {any} */ (th));
      }
      thead.appendChild(/** @type {any} */ (headRow));
      table.appendChild(/** @type {any} */ (thead));

      const tbody = document.createElement('tbody');
      for (const { month, counts } of this._outcomeSummary.byMonth) {
        const tr = document.createElement('tr');
        const tdMonth = document.createElement('td');
        tdMonth.textContent = month;
        tr.appendChild(/** @type {any} */ (tdMonth));
        for (const label of allOutcomes) {
          const td = document.createElement('td');
          td.textContent = String(counts[label] ?? 0);
          tr.appendChild(/** @type {any} */ (td));
        }
        tbody.appendChild(/** @type {any} */ (tr));
      }
      table.appendChild(/** @type {any} */ (tbody));
    }

    section.replaceChildren(
      /** @type {any} */ (h2),
      /** @type {any} */ (stats),
      /** @type {any} */ (table),
    );
    return section;
  }

  _buildRemediationSection() {
    const section = document.createElement('section');
    section.className = 'cr-rp-remediation';

    const h2 = document.createElement('h2');
    h2.textContent = 'Outstanding Remediation Actions';

    // Case type filter (lives outside the cr-case-table — see ADR-0003)
    const caseTypes = [...new Set(this._remediationCases.map(c => c.caseType))];
    const select = document.createElement('select');
    select.className = 'cr-rp-remediation-filter';
    select.setAttribute('aria-label', 'Filter by Case Type');

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'All Case Types';
    select.appendChild(/** @type {any} */ (defaultOpt));
    for (const ct of caseTypes) {
      const opt = document.createElement('option');
      opt.value = ct;
      opt.textContent = ct;
      select.appendChild(/** @type {any} */ (opt));
    }
    select.addEventListener('change', (/** @type {any} */ e) => {
      this._caseTypeFilter = e.target?.value ?? '';
      this._refreshRemediationCases();
    });

    const table = this._buildRemediationTable();
    this._remediationTable = table;

    section.replaceChildren(
      /** @type {any} */ (h2),
      /** @type {any} */ (select),
      /** @type {any} */ (table),
    );
    return section;
  }

  _buildRemediationTable() {
    const now = new Date().toISOString();
    const table = new CRCaseTable();
    /** @type {any} */ (table).toolbar = 'hidden';
    /** @type {any} */ (table).sort = { key: 'dueDate', dir: 'asc' };
    /** @type {any} */ (table).columns = [
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
          this._getOpenActions(r).map(ra => ra.text).join('; '),
      },
    ];
    /** @type {any} */ (table).rowClass = (/** @type {CaseRow} */ r) => {
      const overdue = !!r.dueDate && r.dueDate < now;
      return overdue ? 'cr-remediation-row cr-overdue' : 'cr-remediation-row';
    };
    table.cases = this._filteredRemediationCases();
    table.connectedCallback();
    return table;
  }

  _filteredRemediationCases() {
    if (!this._caseTypeFilter) return this._remediationCases;
    return this._remediationCases.filter(c => c.caseType === this._caseTypeFilter);
  }

  _refreshRemediationCases() {
    if (this._remediationTable) {
      this._remediationTable.cases = this._filteredRemediationCases();
    }
  }

  _buildMessagesSection() {
    const section = document.createElement('section');
    section.className = 'cr-rp-messages';

    const h2 = document.createElement('h2');
    h2.textContent = 'Cases with Unread Messages';

    const table = new CRCaseTable();
    /** @type {any} */ (table).toolbar = 'hidden';
    /** @type {any} */ (table).sort = { key: 'lastMessage', dir: 'desc' };
    /** @type {any} */ (table).columns = [
      {
        key: 'reference',
        label: 'Reference',
        getValue: (/** @type {CaseRow} */ r) => r.title || r.id,
        renderCell: (/** @type {CaseRow} */ r) => {
          const a = document.createElement('a');
          a.href = `#/case/${r.id}`;
          a.textContent = r.title || r.id;
          return a;
        },
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
        getValue: (/** @type {CaseRow} */ r) => r.conversation.at(-1)?.timestamp ?? null,
        renderCell: (/** @type {CaseRow} */ r) => {
          const ts = r.conversation.at(-1)?.timestamp;
          return ts ? new Date(ts).toLocaleString() : '—';
        },
      },
      {
        key: 'actions',
        label: 'Actions',
        renderCell: (/** @type {CaseRow} */ r) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cr-case-open-btn';
          btn.textContent = 'Open';
          btn.setAttribute('aria-label', `Open ${r.title || r.id}`);
          btn.addEventListener('click', () => {
            table.dispatchEvent(new CustomEvent('cr-case-open', {
              detail: { caseId: r.id }, bubbles: true,
            }));
          });
          return btn;
        },
      },
    ];
    table.cases = this._unreadCases;
    table.addEventListener('cr-case-open', (/** @type {any} */ e) => {
      this.dispatchEvent(new CustomEvent('cr-open-conversation', {
        detail: { caseId: e.detail.caseId },
        bubbles: true,
      }));
    });
    table.connectedCallback();

    section.replaceChildren(
      /** @type {any} */ (h2),
      /** @type {any} */ (table),
    );
    return section;
  }

  /** @param {CaseRow} c */
  _hasOpenActions(c) {
    for (const answer of Object.values(c.answers)) {
      if (answer.remediationActions?.some(ra => !ra.completed)) return true;
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
    const rpMessages = msgs.filter(m => m.author === this.currentUserId);
    const lastRpTime = rpMessages.length > 0 ? rpMessages[rpMessages.length - 1].timestamp : null;
    return msgs.some(m => m.author !== this.currentUserId && (lastRpTime === null || m.timestamp > lastRpTime));
  }
}

customElements.define('cr-responsible-party-dashboard', CRResponsiblePartyDashboard);
