// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export class CRReportsIndex extends ReactiveElement {
  constructor() {
    super();
    /** @type {Capabilities} */
    this.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false, isResponsiblePartyManager: false, isMaintainer: false, isQaReviewer: false, isVisitor: false };
  }

  render() {
    /** @type {import('../lib/html.js').VNode[]} */
    const children = [];

    if (this.capabilities.isReviewerManager) {
      children.push(
        h('div', { className: 'cr-report-card' },
          h('h2', {}, 'Reviewer Team Performance'),
          h('a', { href: '#/reports/reviewer-team' }, 'View report')
        )
      );
    } else {
      children.push(
        h('p', {}, "You don't have access to any reports")
      );
    }

    return children;
  }
}

customElements.define('cr-reports-index', CRReportsIndex);
