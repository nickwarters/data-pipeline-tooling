// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').Message} Message */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRConversation extends ReactiveElement {
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
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'edit';
  }

  connectedCallback() {
    super.connectedCallback();
    if (
      typeof document !== 'undefined' &&
      typeof document.addEventListener === 'function'
    ) {
      this._visibilityHandler = () => {
        if (!document.hidden) this._refresh();
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (
      this._visibilityHandler &&
      typeof document !== 'undefined' &&
      typeof document.removeEventListener === 'function'
    ) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  /**
   * @param {Message[]} messages
   */
  set messages(messages) {
    this.update(messages);
  }
  /** @param {Message[]} messages */
  update(messages) {
    this._messages = messages;
    this._render();
  }

  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (content && typeof content === 'object' && 'appendChild' in content) {
        this.replaceChildren(/** @type {any} */ (content));
      } else if (Array.isArray(content)) {
        this.replaceChildren(...content);
      } else {
        this.replaceChildren();
      }
    }
  }

  render() {
    const children = [h('h2', {}, 'Conversation')];

    if (this._messages.length === 0) {
      children.push(
        h('p', { class: 'cr-conversation-empty' }, 'No messages yet.')
      );
    } else {
      children.push(
        h(
          'ul',
          { class: 'cr-conversation-list' },
          ...this._messages.map((msg) => this._renderMessage(msg))
        )
      );
    }

    if (this.access === 'edit') {
      children.push(this._renderCompose());
    }
    return children;
  }

  /**
   * @param {Message} msg
   */
  _renderMessage(msg) {
    return h(
      'li',
      { class: 'cr-conversation-message' },
      h('p', { class: 'cr-message-author' }, msg.author),
      h(
        'p',
        { class: 'cr-message-timestamp' },
        new Date(msg.timestamp).toLocaleString()
      ),
      h('p', { class: 'cr-message-body' }, msg.body)
    );
  }

  _renderCompose() {
    /** @type {HTMLTextAreaElement} */
    let textarea;
    return h(
      'div',
      { class: 'cr-conversation-compose' },
      (textarea = /** @type {HTMLTextAreaElement} */ (
        h('textarea', {
          class: 'cr-conversation-input',
          'aria-label': 'Message to Responsible Party',
        })
      )),
      h(
        'button',
        {
          class: 'cr-conversation-send',
          onclick: async () => {
            const body = (textarea.value ?? '').trim();
            if (!body) return;
            /** @type {any} */ (textarea).value = '';
            await this._sendMessage(body);
          },
        },
        'Send'
      )
    );
  }

  /**
   * @param {string} body
   */
  async _sendMessage(body) {
    if (!this.client || !this.saveQueue || !this.caseId || !this.currentUser)
      return;

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
