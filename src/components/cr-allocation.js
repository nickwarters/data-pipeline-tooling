// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

export class CRAllocation extends ReactiveElement {
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
    if (this.isEmpty) {
      return h('p', { className: 'cr-allocation-empty' }, 'No Cases available');
    }
    return h(
      'button',
      {
        className: 'cr-allocation-btn',
        onClick: () => this._requestNextCase(),
      },
      'Request next Case'
    );
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
          new CustomEvent('cr-allocated', {
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
    if (!this.client) return [];
    const all = await this.client.listCases({ status: 'In-progress' });
    return all
      .filter(
        (c) =>
          c.assignedReviewer === '' &&
          this.eligibleCaseTypes.includes(c.caseType)
      )
      .sort((a, b) => ((a.created ?? '') < (b.created ?? '') ? -1 : 1));
  }

  _renderEmpty() {
    this.isEmpty = true;
    this._render();
  }
}

customElements.define('cr-allocation', CRAllocation);
