// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { signal } from '../lib/signal.js';
import { h } from '../lib/html.js';
import '../components/cr-case-table.js';
import '../components/cr-allocation.js';
import '../components/cr-owner-summary.js';
import './cr-responsible-party-dashboard.js';
import { isOverdue } from '../evaluators/overdue-evaluator.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export class CRDashboard extends ReactiveElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {Capabilities} */
    this.capabilities = {
      isReviewer: false,
      ownedCaseTypes: [],
      isResponsibleParty: false,
      isReviewerManager: false,
      isResponsiblePartyManager: false,
      isMaintainer: false,
      isQaReviewer: false,
      isVisitor: false,
    };
    /** @type {string[]} */
    this.eligibleCaseTypes = [];

    /** @type {import('../lib/signal.js').Signal<CaseRow[]>} */
    this._cases = signal(/** @type {CaseRow[]} */ ([]));
  }

  async connectedCallback() {
    super.connectedCallback();
    await this._fetchData();
  }

  async _fetchData() {
    if (!this.client) return;
    if (this.capabilities.isReviewer) {
      const raw = await this.client.listCases({
        status: 'In-progress',
        assignedReviewer: this.currentUserId,
      });
      this._cases.set(raw.map((c) => ({ ...c, overdue: isOverdue(c) })));
    }
  }

  render() {
    const children = [];

    if (this.capabilities.isReviewer) {
      children.push(h('h1', {}, 'Outstanding Cases'));

      children.push(
        h('cr-case-table', {
          cases: this._cases.get(),
          'oncr-case-open': (/** @type {any} */ e) => {
            location.hash = `#/case/${e.detail.caseId}`;
          },
        })
      );

      children.push(
        h('cr-allocation', {
          client: this.client,
          currentUserId: this.currentUserId,
          eligibleCaseTypes: this.eligibleCaseTypes,
          'oncr-allocated': () => this._fetchData(),
        })
      );
    }

    if (this.capabilities.ownedCaseTypes.length > 0) {
      children.push(
        h('cr-owner-summary', {
          client: this.client,
          ownedCaseTypes: this.capabilities.ownedCaseTypes,
        })
      );
    }

    if (this.capabilities.isResponsibleParty) {
      children.push(
        h('cr-responsible-party-dashboard', {
          client: this.client,
          currentUserId: this.currentUserId,
          'oncr-open-conversation': (/** @type {any} */ e) => {
            location.hash = `#/conversation/${e.detail.caseId}`;
          },
        })
      );
    }

    return children;
  }
}

customElements.define('cr-dashboard', CRDashboard);
