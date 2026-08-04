// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').CaseDetailField} CaseDetailField */

/**
 * The Case Details fields shown on the Case, in display order. Shared with the
 * Summary view so both surfaces use the same configured fields and empty-value
 * fallback.
 *
 * @param {CaseRow} caseRow
 * @param {CaseDetailField[]} [detailFields]
 * @returns {Array<{ field: string, label: string, value: string | null | undefined, display: string }>}
 */
export function caseDetailFields(caseRow, detailFields = []) {
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
    {
      field: 'completedAt',
      label: 'Completed on',
      value: caseRow.completedAt,
    },
    ...detailFields.map((field) => ({
      field: field.key,
      label: field.label,
      value: caseRow.details?.[field.key],
    })),
  ];
  return fields.map((field) => ({
    ...field,
    display: field.value ? field.value : '—',
  }));
}

/**
 * Store-driven Case Details view. It deliberately mirrors the existing
 * Section: common Case fields first, then Case Type-configured fields, with an
 * em dash for empty values. Details remains read-only under section-access.
 *
 * @param {CaseRow} caseRow
 * @param {CaseDetailField[]} detailFields
 * @param {string} heading The Section's resolved heading.
 * @returns {HTMLElement}
 */
export function caseDetailsView(caseRow, detailFields, heading) {
  const fields = caseDetailFields(caseRow, detailFields);

  return h(
    'section',
    { className: 'cora-case-details', 'data-access': 'read-only' },
    h('h2', {}, heading),
    h(
      'dl',
      { className: 'cora-case-details-list' },
      ...fields.flatMap(({ field, label, display }) => [
        h('dt', { className: 'cora-case-details-label' }, label),
        h(
          'dd',
          {
            className: 'cora-case-details-value',
            'data-field': field,
          },
          display
        ),
      ])
    )
  );
}
