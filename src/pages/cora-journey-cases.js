// @ts-check
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';
import { h } from '../lib/html.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { fetchJourneyCases } from '../services/journey-cases-fetcher.js';
import '../components/collections/cora-case-table.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

/**
 * Journey Owner cross-case Summary view. Lists every Case of
 * the Journey Owner's Case Type(s) (`journeyCaseSources`), each row linking
 * into that Case's read-only Summary. The per-Case `summary` matrix cell grants
 * `journeyOwner: read-only`, so the links resolve without any per-Case ACL row.
 *
 * @param {{ client: SharePointClient|null, journeyCaseSources: CaseSource[] }} props
 * @returns {HTMLElement}
 */
export function JourneyCasesPage({ client, journeyCaseSources }) {
  /** @type {import('../lib/signal.js').Signal<CaseRow[] | null>} */
  const cases = signal(/** @type {CaseRow[] | null} */ (null));

  async function fetchData() {
    if (!client) return;
    cases.set(await fetchJourneyCases(client, journeyCaseSources));
  }

  const host = reactive(() =>
    renderJourneyCases({ client, cases: cases.get() })
  );
  fetchData();
  return host;
}

/**
 * @param {{ client: SharePointClient|null, cases: CaseRow[] | null }} props
 * @returns {Node[]}
 */
function renderJourneyCases({ client, cases }) {
  const h1 = h('h1', {}, 'Journey Cases');

  if (!client || !cases) {
    return [h1];
  }

  if (cases.length === 0) {
    return [h1, h('p', {}, 'No cases of your Case Type(s) yet.')];
  }

  return [
    h1,
    h('cora-case-table', {
      toolbar: 'hidden',
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
          key: 'status',
          label: 'Status',
          getValue: (/** @type {CaseRow} */ r) => r.status,
        },
      ],
      cases,
    }),
  ];
}
