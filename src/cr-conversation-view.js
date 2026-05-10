// @ts-check
import { CRElement } from './cr-element.js';
import './cr-conversation.js';

/** @typedef {import('./sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('./save-queue.js').SaveQueue} SaveQueue */

/**
 * Lightweight conversation-only view for the Responsible Party.
 * Shows only the Conversation thread — no Q&A, Notes, or Reviewer identity.
 */
export class CRConversationView extends CRElement {
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
  }

  async connectedCallback() {
    if (!this.client || !this.caseId) return;
    const caseRow = await this.client.getCase(this.caseId);
    if (!caseRow) return;

    const header = document.createElement('header');
    header.className = 'cr-conversation-view-header';

    const h1 = document.createElement('h1');
    h1.textContent = caseRow.title || caseRow.id;

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'cr-back-btn';
    backBtn.textContent = '← My Reviews';
    backBtn.addEventListener('click', () => { location.hash = '#/my-reviews'; });

    header.replaceChildren(/** @type {any} */ (backBtn), /** @type {any} */ (h1));

    const conversationEl = /** @type {import('./cr-conversation.js').CRConversation} */ (
      document.createElement('cr-conversation')
    );
    conversationEl.client = this.client;
    conversationEl.saveQueue = this.saveQueue;
    conversationEl.caseId = this.caseId;
    conversationEl.currentUser = this.currentUser;
    conversationEl.update(caseRow.conversation);

    this.replaceChildren(
      /** @type {any} */ (header),
      /** @type {any} */ (conversationEl),
    );
  }
}

customElements.define('cr-conversation-view', CRConversationView);
