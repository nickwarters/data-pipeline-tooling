// @ts-check
import { ShellElement } from '../lib/view.js';
import { ReportsIndexPage } from './reports-index-page.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export { ReportsIndexPage };

// TODO(simplify-ui): Remove this compatibility wrapper once all routes and
// tests consume ReportsIndexPage() directly.
export class CRReportsIndex extends ShellElement {
  constructor() {
    super();
    /** @type {Capabilities} */
    this.capabilities = {
      isReviewer: false,
      listAccessCaseTypes: [],
      isAdviser: false,
      ownedCaseTypes: [],
      ownedJourneyCaseTypes: [],
      isControls: false,
      isReviewerManager: false,
      isResponsiblePartyManager: false,
      isMaintainer: false,
      isVisitor: false,
    };
  }

  render() {
    return ReportsIndexPage({ capabilities: this.capabilities });
  }
}

customElements.define('cr-reports-index', CRReportsIndex);
