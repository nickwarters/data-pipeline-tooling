// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('./sharepoint-client.js').Message} Message */
/** @typedef {import('./sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('./sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('./save-queue.js').SaveQueue} SaveQueue */

export class CRConversation extends CRElement {
  constructor() {
    super();
    /** @type {Message[]} */
    this._messages = [];
    /** @type {SharePointClient | null} */
    this.client = null;
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** @type {string} */
    this.caseId = '';
    /** @type {CurrentUser | null} */
    this.currentUser = null;
    /** @type {(() => void) | null} */
    this._visibilityHandler = null;
  }

  connectedCallback() {
    this._render();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this._visibilityHandler = () => {
        if (!document.hidden) this._refresh();
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._visibilityHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  /**
   * @param {Message[]} messages
   */
  update(messages) {
    this._messages = messages;
    this._render();
  }

  _render() {
    const heading = document.createElement('h2');
    heading.textContent = 'Conversation';

    /** @type {HTMLElement[]} */
    const children = [/** @type {any} */ (heading)];

    if (this._messages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'cr-conversation-empty';
      empty.textContent = 'No messages yet.';
      children.push(/** @type {any} */ (empty));
    } else {
      const list = document.createElement('ul');
      list.className = 'cr-conversation-list';
      for (const msg of this._messages) {
        list.appendChild(/** @type {any} */ (this._renderMessage(msg)));
      }
      children.push(/** @type {any} */ (list));
    }

    children.push(/** @type {any} */ (this._renderCompose()));
    this.replaceChildren(...children);
  }

  /**
   * @param {Message} msg
   * @returns {HTMLElement}
   */
  _renderMessage(msg) {
    const li = document.createElement('li');
    li.className = 'cr-conversation-message';

    const author = document.createElement('p');
    author.className = 'cr-message-author';
    author.textContent = msg.author;

    const ts = document.createElement('p');
    ts.className = 'cr-message-timestamp';
    ts.textContent = new Date(msg.timestamp).toLocaleString();

    const body = document.createElement('p');
    body.className = 'cr-message-body';
    body.textContent = msg.body;

    li.append(/** @type {any} */ (author), /** @type {any} */ (ts), /** @type {any} */ (body));
    return /** @type {HTMLElement} */ (/** @type {unknown} */ (li));
  }

  /**
   * @returns {HTMLElement}
   */
  _renderCompose() {
    const div = document.createElement('div');
    div.className = 'cr-conversation-compose';

    const textarea = /** @type {HTMLTextAreaElement} */ (/** @type {unknown} */ (document.createElement('textarea')));
    /** @type {any} */ (textarea).className = 'cr-conversation-input';
    /** @type {any} */ (textarea).setAttribute?.('aria-label', 'Message to Responsible Party');

    const btn = document.createElement('button');
    btn.className = 'cr-conversation-send';
    btn.textContent = 'Send';

    btn.addEventListener('click', async () => {
      const body = (/** @type {any} */ (textarea).value ?? '').trim();
      if (!body) return;
      /** @type {any} */ (textarea).value = '';
      await this._sendMessage(body);
    });

    /** @type {any} */ (div).append(textarea, btn);
    return /** @type {HTMLElement} */ (/** @type {unknown} */ (div));
  }

  /**
   * @param {string} body
   */
  async _sendMessage(body) {
    if (!this.client || !this.saveQueue || !this.caseId || !this.currentUser) return;

    /** @type {Message} */
    const msg = {
      author: this.currentUser.displayName,
      timestamp: new Date().toISOString(),
      body,
    };

    this._messages = [...this._messages, msg];
    this._render();

    const etag = this.saveQueue.getEtag(this.caseId);
    const result = await this.client.patchCase(
      this.caseId,
      { conversation: this._messages },
      etag
    );

    if (result.ok && result.data) {
      this.saveQueue.loadCase(result.data);
    }
  }

  async _refresh() {
    if (!this.client || !this.caseId) return;
    const fresh = await this.client.getCase(this.caseId);
    if (fresh) {
      this._messages = fresh.conversation;
      this._render();
    }
  }
}

customElements.define('cr-conversation', CRConversation);
