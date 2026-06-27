// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { signal } from '../lib/signal.js';
import { h } from '../lib/html.js';
import '../components/cr-conversation.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * Lightweight conversation-only view for the Responsible Party.
 * Shows only the Conversation thread — no Q&A, Notes, or Reviewer identity.
 */
export class CRConversationView extends ReactiveElement {
  constructor() {
    super();
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** @type {string} */
    this.caseId = '';
    /** @type {CurrentUser | null} */
    this.currentUser = null;

    /** @type {import('../lib/signal.js').Signal<CaseRow | null>} */
    this._caseRow = signal(/** @type {CaseRow | null} */ (null));
  }

  async connectedCallback() {
    super.connectedCallback();
    if (!this.client || !this.caseId) return;
    const caseRow = await this.client.getCase(this.caseId);
    if (!caseRow) return;
    this._caseRow.set(caseRow);
  }

  render() {
    const caseRow = this._caseRow.get();
    if (!caseRow) return [];

    return [
      h(
        'header',
        { className: 'cr-conversation-view-header' },
        h(
          'button',
          {
            type: 'button',
            className: 'cr-back-btn',
            onclick: () => {
              location.hash = '#/my-reviews';
            },
          },
          '← My Reviews'
        ),
        h('h1', {}, caseRow.title || caseRow.id)
      ),
      h('cr-conversation', {
        client: this.client,
        saveQueue: this.saveQueue,
        caseId: this.caseId,
        currentUser: this.currentUser,
        messages: caseRow.conversation,
      }),
    ];
  }
}

customElements.define('cr-conversation-view', CRConversationView);
