// @ts-check
import { signal } from '../../lib/signal.js';
import { reactive } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { caseRouteFor } from '../../lib/case-route-links.js';
import './cora-case-table.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').Appeal} Appeal */

/**
 * How many rows a page pulls from the indexed open-Appeal set. The worklist
 * shows every open Appeal, so pages accumulate until a short final page — the
 * point is never to fetch an unbounded result set, not to cap the
 * table.
 */
export const PAGE_SIZE = 50;

/**
 * Pages a single source list's open-Appeal set to exhaustion (a short final
 * page ends the loop), oldest-raised-first. One list's worth of the merge
 * `fetchData` performs across every source.
 *
 * @param {SharePointClient} client
 * @param {import('../../setup/resolve-eligible-case-types.js').CaseSource} source
 * @returns {Promise<CaseRow[]>}
 */
async function fetchAllOpenAppeals(client, source) {
  /** @type {CaseRow[]} */
  const all = [];
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
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * The single open **Appeal** on a Case, or null. An Appeal is "open" — i.e. not
 * yet worked by **Controls** — while its `state` is anything other than
 * `resolved` (`raised` or `underReview`). At most one Appeal is open at a time
 * (CONTEXT.md), so first-match is the open one.
 *
 * @param {CaseRow} caseRow
 * @returns {Appeal | null}
 */
export function openAppealOf(caseRow) {
  return (caseRow.appeals ?? []).find((a) => a.state !== 'resolved') ?? null;
}

/**
 * Controls landing section: every Case with an open **Appeal** that Controls has
 * not yet resolved. Controls is not scoped to a single Case Type, so
 * this reads the whole list — but leads with the indexed `hasOpenAppeal` flag
 * and pages oldest-raised-first (`appealRaisedAt asc`) rather than fetching all
 * Completed Cases and filtering in JS, which breaks past the List View Threshold
 * on the busy Case Type. The matched set is bounded by
 * open work, so it stays sub-threshold for the life of the list.
 *
 * @param {{
 * client: SharePointClient | null,
 * allCaseSources?: import('../../setup/resolve-eligible-case-types.js').CaseSource[],
 * onOpenCase?: (caseRow: CaseRow) => void,
 * }} props
 * @returns {HTMLElement}
 */
export function ControlsDashboard({ client, allCaseSources = [], onOpenCase }) {
  /** @type {import('../../lib/signal.js').Signal<CaseRow[]>} */
  const appealCases = signal(/** @type {CaseRow[]} */ ([]));

  async function fetchData() {
    if (!client) return;
    // No default Case list, and Controls is not scoped to a single Case
    // Type, so this pages each source list to exhaustion (leading with the
    // indexed `hasOpenAppeal` flag, same as before) and then merges the
    // per-list pages by sorting the combined set on `appealRaisedAt asc` —
    // the per-list `orderBy` only guarantees order within a single list's
    // pages, not across lists, so the final sort is what preserves the
    // oldest-raised-first order the table relies on.
    const perList = await Promise.all(
      allCaseSources.map((source) => fetchAllOpenAppeals(client, source))
    );
    const all = perList.flat();
    all.sort((a, b) => {
      const aAt = openAppealOf(a)?.at ?? '';
      const bAt = openAppealOf(b)?.at ?? '';
      return aAt < bAt ? -1 : aAt > bAt ? 1 : 0;
    });
    appealCases.set(all);
  }

  const host = reactive(() => {
    if (!client) return [];
    return [buildAppealsSection(appealCases.get(), onOpenCase)];
  });

  void fetchData();
  return host;
}

/**
 * @param {CaseRow[]} cases
 * @param {((caseRow: CaseRow) => void) | undefined} onOpenCase
 * @returns {HTMLElement}
 */
function buildAppealsSection(cases, onOpenCase) {
  return h(
    'section',
    { className: 'cora-controls-appeals' },
    h('h2', {}, 'Outstanding Appeals'),
    h('cora-case-table', {
      toolbar: 'hidden',
      sort: { key: 'raised', dir: 'asc' },
      columns: [
        {
          key: 'reference',
          label: 'Reference',
          getValue: (/** @type {CaseRow} */ r) => r.title || r.id,
          renderCell: (/** @type {CaseRow} */ r) =>
            h('a', { href: caseRouteFor(r) }, r.title || r.id),
        },
        {
          key: 'caseType',
          label: 'Case Type',
          getValue: (/** @type {CaseRow} */ r) => r.caseType,
        },
        {
          key: 'responsibleParty',
          label: 'Responsible Party',
          getValue: (/** @type {CaseRow} */ r) => r.responsibleParty,
        },
        {
          key: 'appellant',
          label: 'Appellant',
          getValue: (/** @type {CaseRow} */ r) =>
            openAppealOf(r)?.appellant ?? '',
        },
        {
          key: 'raised',
          label: 'Raised',
          sortable: true,
          getValue: (/** @type {CaseRow} */ r) => openAppealOf(r)?.at ?? null,
          renderCell: (/** @type {CaseRow} */ r) => {
            const at = openAppealOf(r)?.at;
            return at ? new Date(at).toLocaleDateString() : '—';
          },
        },
        {
          key: 'rationale',
          label: 'Appellant rationale',
          getValue: (/** @type {CaseRow} */ r) =>
            openAppealOf(r)?.rationale ?? '',
        },
        {
          key: 'actions',
          label: 'Actions',
          renderCell: (/** @type {CaseRow} */ r) =>
            h(
              'button',
              {
                type: 'button',
                className: 'cora-case-open-btn',
                'aria-label': `Open ${r.title || r.id}`,
                onclick: () => onOpenCase?.(r),
              },
              'Open'
            ),
        },
      ],
      cases,
      'oncora-case-open': (/** @type {any} */ e) => {
        onOpenCase?.(e.detail.caseRow);
      },
    })
  );
}
