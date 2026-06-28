// @ts-check
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * The Case Details fields shown on the Case (ADR-0014), in display order. Shared
 * by the Case Details Section and the Summary Section's Details block (ADR-0016)
 * so the field list and em-dash fallback live in one place. `display` is the
 * presentation-ready string (em dash for empty values); `value` is the raw field.
 *
 * @param {CaseRow} caseRow
 * @returns {Array<{ field: string, label: string, value: string | null | undefined, display: string }>}
 */
export function caseDetailFields(caseRow) {
  /** @type {Array<{ field: string, label: string, value: string | null | undefined }>} */
  const fields = [
    { field: 'title', label: 'Title', value: caseRow.title },
    {
      field: 'assignedReviewer',
      label: 'Assigned Reviewer',
      value: caseRow.assignedReviewer,
    },
    { field: 'status', label: 'Status', value: caseRow.status },
    { field: 'dueDate', label: 'Due date', value: caseRow.dueDate },
    { field: 'relatedDate', label: 'Related date', value: caseRow.relatedDate },
    { field: 'created', label: 'Created', value: caseRow.created },
    { field: 'completedAt', label: 'Completed', value: caseRow.completedAt },
  ];
  return fields.map((f) => ({ ...f, display: f.value ? f.value : '—' }));
}

/**
 * The Case Details Section (ADR-0014). Read-only for every role and never
 * hidden per-role (see section-access.js). This slice renders only the
 * placeholder content — fields already on the Case row (title, assigned
 * reviewer, status, dates). The Case Type-specific detail fields and their
 * storage are explicitly out of scope and ship in a follow-on slice.
 */
/**
 * @typedef {Object} CaseDetailsProps
 * @property {CaseRow | null} caseRow
 * @property {'edit'|'read-only'|'hidden'} access
 */

/**
 * @param {CaseDetailsProps} props
 * @returns {Node[]}
 */
export function CaseDetails({ caseRow }) {
  if (!caseRow) return [];

  return [
    h('h2', {}, 'Case Details'),
    h(
      'dl',
      { className: 'cr-case-details-list' },
      ...caseDetailFields(caseRow).flatMap(({ field, label, display }) => [
        h('dt', { className: 'cr-case-details-label' }, label),
        h(
          'dd',
          { className: 'cr-case-details-value', 'data-field': field },
          display
        ),
      ])
    ),
  ];
}

export class CRCaseDetails extends HTMLElement {
  constructor() {
    super();
    /** @type {CaseRow | null} */
    this.caseRow = null;
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'read-only';
  }

  connectedCallback() {
    this.setAttribute('data-access', this.access);
    this._render();
  }

  _render() {
    this.replaceChildren(
      ...CaseDetails({ caseRow: this.caseRow, access: this.access })
    );
  }
}

customElements.define('cr-case-details', CRCaseDetails);
