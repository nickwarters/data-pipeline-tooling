// @ts-check
import { h } from '../../lib/html.js';
import { caseDetailFields } from '../../components/sections/cora-case-details.js';

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
  const fields = caseDetailFields(caseRow, detailFields);

  return h(
    'section',
    { className: 'cora-case-details', 'data-access': 'read-only' },
    h('h2', {}, 'Case Details'),
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
