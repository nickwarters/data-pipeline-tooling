// @ts-check
import { h } from '../../lib/html.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').CaseDetailField} CaseDetailField */

/**
 * Store-driven Case Details view. It deliberately mirrors the existing
 * Section: common Case fields first, then Case Type-configured fields, with an
 * em dash for empty values. Details remains read-only under section-access.
 *
 * @param {CaseRow} caseRow
 * @param {CaseDetailField[]} [detailFields]
 * @returns {HTMLElement}
 */
export function caseDetailsView(caseRow, detailFields = []) {
  const fields = [
    { key: 'title', label: 'Title', value: caseRow.title },
    {
      key: 'assignedReviewer',
      label: 'Assigned Reviewer',
      value: caseRow.assignedReviewer,
    },
    { key: 'status', label: 'Status', value: caseRow.status },
    { key: 'dueDate', label: 'Due date', value: caseRow.dueDate },
    { key: 'relatedDate', label: 'Related date', value: caseRow.relatedDate },
    { key: 'created', label: 'Created', value: caseRow.created },
    {
      key: 'completedAt',
      label: CASE_STATUS.COMPLETED,
      value: caseRow.completedAt,
    },
    ...detailFields.map((field) => ({
      key: field.key,
      label: field.label,
      value: caseRow.details?.[field.key],
    })),
  ];

  return h(
    'section',
    { className: 'cora-case-details', 'data-access': 'read-only' },
    h('h2', {}, 'Case Details'),
    h(
      'dl',
      { className: 'cora-case-details-list' },
      ...fields.flatMap((field) => [
        h('dt', { className: 'cora-case-details-label' }, field.label),
        h(
          'dd',
          {
            className: 'cora-case-details-value',
            'data-field': field.key,
          },
          field.value ? field.value : '—'
        ),
      ])
    )
  );
}
