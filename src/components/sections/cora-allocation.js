// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @param {{ isEmpty: boolean, onRequestNextCase: () => void }} props
 * @returns {HTMLElement}
 */
export function Allocation({ isEmpty, onRequestNextCase }) {
  if (isEmpty) {
    return h('p', { className: 'cora-allocation-empty' }, 'No Cases available');
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
 * @param {{
 *   client: SharePointClient | null,
 *   eligibleCaseTypes: string[]
 * }} props
 * @returns {Promise<CaseRow[]>}
 */
export async function getUnassignedCases({ client, eligibleCaseTypes }) {
  if (!client) return [];
  const all = await client.listCases({ status: 'In-progress' });
  return all
    .filter(
      (c) => c.assignedReviewer === '' && eligibleCaseTypes.includes(c.caseType)
    )
    .sort((a, b) => ((a.created ?? '') < (b.created ?? '') ? -1 : 1));
}

export class CORAAllocation extends ShellElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
    /** @type {boolean} */
    this.isEmpty = false;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  _render() {
    const content = this.render();
    if (content) {
      if (Array.isArray(content)) {
        this.replaceChildren(...content);
      } else {
        this.replaceChildren(content);
      }
    } else {
      this.replaceChildren();
    }
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
        c.etag
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
      // 412 — another reviewer won the race; try the next candidate
    }
    this._renderEmpty();
  }

  /** @returns {Promise<CaseRow[]>} */
  async _getUnassignedCases() {
    return getUnassignedCases({
      client: this.client,
      eligibleCaseTypes: this.eligibleCaseTypes,
    });
  }

  _renderEmpty() {
    this.isEmpty = true;
    this._render();
  }
}

customElements.define('cora-allocation', CORAAllocation);
