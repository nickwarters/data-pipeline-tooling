// @ts-check
import { h } from '../../lib/html.js';
import {
  NO_VALUE,
  formatDate,
  formatDateLike,
  formatTimestamp,
} from '../../lib/format-datetime.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').CaseDetailField} CaseDetailField */

/**
 * What a Case Details field holds, which is what decides how it is written.
 * `unknown` is the honest answer for a Case Type-configured field: its meaning
 * is not declared anywhere, so only its shape can be read.
 *
 * @typedef {'text' | 'date' | 'timestamp' | 'unknown'} DetailFieldKind
 */

/**
 * The Case Details fields shown on the Case, in display order. Shared with the
 * Summary view so both surfaces use the same configured fields, formatting and
 * empty-value fallback.
 *
 * @param {CaseRow} caseRow
 * @param {CaseDetailField[]} [detailFields]
 * @returns {Array<{ field: string, label: string, value: string | null | undefined, display: string }>}
 */
export function caseDetailFields(caseRow, detailFields = []) {
  /**
   * @type {Array<{
   *   field: string, label: string,
   *   value: string | null | undefined, as?: DetailFieldKind,
   * }>}
   */
  const fields = [
    { field: 'title', label: 'Title', value: caseRow.title },
    {
      field: 'assignedReviewer',
      label: 'Assigned Reviewer',
      value: caseRow.assignedReviewer,
    },
    { field: 'status', label: 'Status', value: caseRow.status },
    { field: 'dueDate', label: 'Due date', value: caseRow.dueDate, as: 'date' },
    {
      field: 'relatedDate',
      label: 'Related date',
      value: caseRow.relatedDate,
      as: 'date',
    },
    {
      field: 'created',
      label: 'Created',
      value: caseRow.created,
      as: 'timestamp',
    },
    {
      field: 'completedAt',
      label: 'Completed on',
      value: caseRow.completedAt,
      as: 'timestamp',
    },
    // A configured field's *meaning* is not declared — `CaseDetailField` is a
    // key and a label — so its shape decides, and anything that is not a date
    // is shown exactly as stored.
    ...detailFields.map((field) => ({
      field: field.key,
      label: field.label,
      value: caseRow.details?.[field.key],
      as: /** @type {DetailFieldKind} */ ('unknown'),
    })),
  ];
  return fields.map((field) => ({
    ...field,
    display: displayOf(field.value, field.as),
  }));
}

/**
 * @param {unknown} value
 * @param {DetailFieldKind} [kind]
 * @returns {string}
 */
function displayOf(value, kind = 'text') {
  if (kind === 'date') return formatDate(value);
  if (kind === 'timestamp') return formatTimestamp(value);
  if (kind === 'unknown') return formatDateLike(value);
  return value ? String(value) : NO_VALUE;
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
