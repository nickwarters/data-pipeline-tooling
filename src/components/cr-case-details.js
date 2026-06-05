// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * The Case Details Section (ADR-0014). Read-only for every role and never
 * hidden per-role (see section-access.js). This slice renders only the
 * placeholder content — fields already on the Case row (title, assigned
 * reviewer, status, dates). The Case Type-specific detail fields and their
 * storage are explicitly out of scope and ship in a follow-on slice.
 */
export class CRCaseDetails extends CRElement {
  constructor() {
    super();
    /** @type {CaseRow | null} */
    this.caseRow = null;
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'read-only';
  }

  connectedCallback() {
    const caseRow = this.caseRow;
    if (!caseRow) return;

    this.setAttribute('data-access', this.access);

    const heading = document.createElement('h2');
    heading.textContent = 'Case Details';

    const dl = document.createElement('dl');
    dl.className = 'cr-case-details-list';

    /** @type {Array<{ field: string, label: string, value: string | null | undefined }>} */
    const fields = [
      { field: 'title', label: 'Title', value: caseRow.title },
      { field: 'assignedReviewer', label: 'Assigned Reviewer', value: caseRow.assignedReviewer },
      { field: 'status', label: 'Status', value: caseRow.status },
      { field: 'dueDate', label: 'Due date', value: caseRow.dueDate },
      { field: 'relatedDate', label: 'Related date', value: caseRow.relatedDate },
      { field: 'created', label: 'Created', value: caseRow.created },
      { field: 'completedAt', label: 'Completed', value: caseRow.completedAt },
    ];

    for (const { field, label, value } of fields) {
      const dt = document.createElement('dt');
      dt.className = 'cr-case-details-label';
      dt.textContent = label;

      const dd = document.createElement('dd');
      dd.className = 'cr-case-details-value';
      dd.setAttribute('data-field', field);
      // No innerHTML: values are assigned as text so any markup is shown
      // verbatim rather than parsed (ADR-0003 / hard rules).
      dd.textContent = value ? value : '—';

      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    this.replaceChildren(
      /** @type {any} */ (heading),
      /** @type {any} */ (dl)
    );
  }
}

customElements.define('cr-case-details', CRCaseDetails);
