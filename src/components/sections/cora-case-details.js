// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').CaseDetailField} CaseDetailField */

/**
 * The Case Details fields shown on the Case, in display order. Shared
 * by the Case Details Section and the Summary Section's Details block
 * so the field list and em-dash fallback live in one place. `display` is the
 * presentation-ready string (em dash for empty values); `value` is the raw field.
 *
 * The common Case-row fields come first, followed by the Case Type-specific
 * fields declared in `detailFields`, whose values are read from the
 * `CaseRow.details` JSON blob keyed by `CaseDetailField.key`.
 *
 * @param {CaseRow} caseRow
 * @param {CaseDetailField[]} [detailFields]
 * @returns {Array<{ field: string, label: string, value: string | null | undefined, display: string }>}
 */
export function caseDetailFields(caseRow, detailFields = []) {
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
    ...detailFields.map((f) => ({
      field: f.key,
      label: f.label,
      value: caseRow.details?.[f.key],
    })),
  ];
  return fields.map((f) => ({ ...f, display: f.value ? f.value : '—' }));
}

/**
 * The Case Details Section. Read-only for every role and never
 * hidden per-role (see section-access.js). Renders the common Case-row fields
 * (title, assigned reviewer, status, dates) followed by the Case Type-specific
 * detail fields declared in `detailFields`, whose values come from
 * the `CaseRow.details` blob.
 */
/**
 * @typedef {Object} CaseDetailsProps
 * @property {CaseRow | null} caseRow
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {CaseDetailField[]} [detailFields]
 */

/**
 * @param {CaseDetailsProps} props
 * @returns {Node[]}
 */
export function CaseDetails({ caseRow, detailFields = [] }) {
  if (!caseRow) return [];

  return [
    h('h2', {}, 'Case Details'),
    h(
      'dl',
      { className: 'cora-case-details-list' },
      ...caseDetailFields(caseRow, detailFields).flatMap(
        ({ field, label, display }) => [
          h('dt', { className: 'cora-case-details-label' }, label),
          h(
            'dd',
            { className: 'cora-case-details-value', 'data-field': field },
            display
          ),
        ]
      )
    ),
  ];
}

export class CORACaseDetails extends HTMLElement {
  constructor() {
    super();
    /** @type {CaseRow | null} */
    this.caseRow = null;
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'read-only';
    /**
     * The Case Type's declared Case Details fields, rendered after
     * the common Case-row fields. Empty when the Case Type declares none.
     * @type {CaseDetailField[]}
     */
    this.detailFields = [];
  }

  connectedCallback() {
    this.setAttribute('data-access', this.access);
    this._render();
  }

  _render() {
    this.replaceChildren(
      ...CaseDetails({
        caseRow: this.caseRow,
        access: this.access,
        detailFields: this.detailFields,
      })
    );
  }
}

customElements.define('cora-case-details', CORACaseDetails);
