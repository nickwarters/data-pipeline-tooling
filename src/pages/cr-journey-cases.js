// @ts-check
import { ShellElement } from '../lib/view.js';
import { signal } from '../lib/signal.js';
import { h } from '../lib/html.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { fetchJourneyCases } from '../services/journey-cases-fetcher.js';
import '../components/cr-case-table.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.

/**
 * Journey Owner cross-case Summary view (ADR-0022/0027). Lists every Case of
 * the Journey Owner's Case Type(s) (`ownedJourneyCaseTypes`), each row linking
 * into that Case's read-only Summary. The per-Case `summary` matrix cell grants
 * `journeyOwner: read-only`, so the links resolve without any per-Case ACL row.
 */
export class CRJourneyCases extends ShellElement {
  constructor() {
    super();
    /** @type {SharePointClient|null} */
    this.client = null;
    /** @type {string[]} */
    this.ownedJourneyCaseTypes = [];

    /** @type {import('../lib/signal.js').Signal<CaseRow[] | null>} */
    this._cases = signal(/** @type {CaseRow[] | null} */ (null));
  }

  async connectedCallback() {
    super.connectedCallback();
    if (!this.client) return;
    const cases = await fetchJourneyCases(
      this.client,
      this.ownedJourneyCaseTypes
    );
    this._cases.set(cases);
  }

  render() {
    const h1 = h('h1', {}, 'Journey Cases');

    const cases = this._cases.get();
    if (!this.client || !cases) {
      return [h1];
    }

    if (cases.length === 0) {
      return [h1, h('p', {}, 'No cases of your Case Type(s) yet.')];
    }

    return [
      h1,
      h('cr-case-table', {
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
}

customElements.define('cr-journey-cases', CRJourneyCases);
