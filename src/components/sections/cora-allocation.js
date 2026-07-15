// @ts-check
import { ShellElement, replaceHostChildren } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { listCasesPerSource } from '../../services/across-sources.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('../../setup/resolve-eligible-case-types.js').AllocationSource} AllocationSource */

/**
 * An unassigned Case picked up from one allocation source, tagged with the
 * `CaseListOptions` (namely `listName`) of the list it came from — so the
 * later `patchCase` write lands on the same list the row was read from.
 *
 * @typedef {CaseRow & { _listOptions: CaseListOptions }} AllocationCandidate
 */

/**
 * @param {{ isEmpty: boolean, onRequestNextCase: () => void }} props
 * @returns {HTMLElement}
 */
export function Allocation({ isEmpty, onRequestNextCase }) {
  if (isEmpty) {
    return EmptyState('No Cases available', {
      className: 'cora-allocation-empty',
    });
  }
  return h(
    'button',
    {
      className: 'cora-allocation-btn',
      onClick: onRequestNextCase,
    },
    'Request next Case'
  );
}

/**
 * Sorts allocation candidates ascending by `created` (matching the previous
 * string-comparator semantics: `created ?? ''`, so missing/null `created`
 * sorts first). Candidates whose `created` is EXACTLY equal are ordered by a
 * per-candidate draw from `random` — a fresh draw per candidate, taken once
 * up front, so the tie-break is stable within a single call and swappable in
 * tests by stubbing `random` (e.g. a queue of canned return values) to force
 * either tied candidate to win.
 *
 * @param {AllocationCandidate[]} candidates
 * @param {() => number} [random]
 * @returns {AllocationCandidate[]}
 */
export function orderCandidatesByAge(candidates, random = Math.random) {
  return candidates
    .map((c) => ({ c, tieBreak: random() }))
    .sort((a, b) => {
      const av = a.c.created ?? '';
      const bv = b.c.created ?? '';
      if (av < bv) return -1;
      if (av > bv) return 1;
      return a.tieBreak - b.tieBreak;
    })
    .map(({ c }) => c);
}

/**
 * @param {{
 * client: SharePointClient | null,
 * allocationSources: AllocationSource[],
 * random?: () => number
 * }} props
 * @returns {Promise<AllocationCandidate[]>}
 */
export async function getUnassignedCases({
  client,
  allocationSources,
  random,
}) {
  if (!client) return [];

  const perSource = await listCasesPerSource(
    client,
    allocationSources,
    (source) => ({ status: CASE_STATUS.IN_PROGRESS, caseType: source.slug })
  );
  const candidates = perSource.flatMap(({ source, rows }) =>
    rows
      .filter((c) => c.assignedReviewer === '')
      .map(
        (c) =>
          /** @type {AllocationCandidate} */ ({
            ...c,
            _listOptions: { listName: source.listName },
          })
      )
  );

  return orderCandidatesByAge(candidates, random);
}

export class CORAAllocation extends ShellElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {AllocationSource[]} */
    this.allocationSources = [];
    /** @type {boolean} */
    this.isEmpty = false;
    /** @type {() => number} */
    this.random = Math.random;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  // Kept: tests call _renderEmpty()/_requestNextCase() before connect, where
  // the base render entry (_shellRenderNow) is a no-op.
  _render() {
    replaceHostChildren(this, this.render());
  }

  render() {
    return Allocation({
      isEmpty: this.isEmpty,
      onRequestNextCase: () => this._requestNextCase(),
    });
  }

  /** @returns {Promise<void>} */
  async _requestNextCase() {
    if (!this.client) return;
    const candidates = await this._getUnassignedCases();
    for (const c of candidates) {
      const result = await this.client.patchCase(
        c.id,
        { assignedReviewer: this.currentUserId },
        c.etag,
        c._listOptions
      );
      if (result.ok) {
        this.dispatchEvent(
          new CustomEvent('cora-allocated', {
            detail: { caseId: c.id },
            bubbles: true,
          })
        );
        return;
      }
      // 412 — another reviewer won the race; try the next candidate, which
      // may live on a different list.
    }
    this._renderEmpty();
  }

  /** @returns {Promise<AllocationCandidate[]>} */
  async _getUnassignedCases() {
    return getUnassignedCases({
      client: this.client,
      allocationSources: this.allocationSources,
      random: this.random,
    });
  }

  _renderEmpty() {
    this.isEmpty = true;
    this._render();
  }
}

customElements.define('cora-allocation', CORAAllocation);
