// @ts-check
import { h } from '../../lib/html.js';
import { caseRouteFor } from '../../lib/case-route-links.js';
import { navigateTo } from '../../lib/navigate.js';
import {
  caseActionsColumn,
  caseReferenceColumn,
  caseTypeColumn,
} from '../../views/case-columns.js';
import { dataTableView } from '../../views/data-table.js';

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').Appeal} Appeal */

export const PAGE_SIZE = 50;

/** @param {CaseRow} row @returns {Appeal | null} */
export function openAppealOf(row) {
  return (
    (row.appeals ?? []).find((appeal) => appeal.state !== 'resolved') ?? null
  );
}

/**
 * @param {import('../../sharepoint-client.js').SharePointClient} client
 * @param {import('../../setup/resolve-eligible-case-types.js').CaseSource[]} sources
 */
export async function fetchOpenAppeals(client, sources) {
  const perSource = await Promise.all(
    sources.map(async (source) => {
      /** @type {CaseRow[]} */
      const rows = [];
      for (let skip = 0; ; skip += PAGE_SIZE) {
        const page = await client.listCases(
          { hasOpenAppeal: true },
          {
            top: PAGE_SIZE,
            skip,
            orderBy: 'appealRaisedAt',
            orderDir: 'asc',
            listName: source.listName,
          }
        );
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      return rows;
    })
  );
  return perSource.flat().sort((a, b) => {
    const aAt = openAppealOf(a)?.at ?? '';
    const bAt = openAppealOf(b)?.at ?? '';
    return aAt < bAt ? -1 : aAt > bAt ? 1 : 0;
  });
}

/**
 * Reference and Case Type are the shared Case descriptors, which is what makes
 * them sortable here (#542) — this table used to spell them out locally, minus
 * `sortable`, for no reason anyone could name. The default sort is untouched:
 * Appeals still open on `{ key: 'raised', dir: 'asc' }`, oldest Appeal first.
 *
 * @returns {import('../../views/data-table.js').ColumnDescriptor<CaseRow>[]}
 */
export function appealColumns() {
  return [
    caseReferenceColumn(),
    caseTypeColumn(),
    {
      key: 'responsibleParty',
      label: 'Responsible Party',
      value: 'responsibleParty',
    },
    {
      key: 'appellant',
      label: 'Appellant',
      value: (row) => openAppealOf(row)?.appellant ?? '',
    },
    {
      key: 'raised',
      label: 'Raised',
      sortable: true,
      value: (row) => openAppealOf(row)?.at ?? null,
      format: (value) =>
        value ? new Date(String(value)).toLocaleDateString() : '—',
    },
    {
      key: 'rationale',
      label: 'Appellant rationale',
      value: (row) => openAppealOf(row)?.rationale ?? '',
    },
    caseActionsColumn((row) => navigateTo(caseRouteFor(row))),
  ];
}

/**
 * @param {CaseRow[]} cases
 * @param {import('../../views/data-table.js').TableSort | null} sort
 * @param {(key: string) => void} onSort
 */
export function controlsAppealsView(cases, sort, onSort) {
  return h(
    'section',
    { className: 'cora-controls-appeals' },
    h('h2', {}, 'Outstanding Appeals'),
    dataTableView({
      rows: cases,
      columns: appealColumns(),
      sort,
      onSort,
      emptyMessage: 'No outstanding appeals.',
      rowKey: (row) => `${row.caseType}:${row.id}`,
      rowHref: caseRouteFor,
    })
  );
}
