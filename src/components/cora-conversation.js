// @ts-check
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').Message} Message */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */

/**
 * @typedef {object} ConversationProps
 * @property {Message[]} messages
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {(body: string) => Promise<void>} sendMessage
 */

/**
 * @param {ConversationProps} props
 * @returns {Node[]}
 */
export function Conversation(props) {
  const children = [h('h2', {}, 'Conversation')];

  if (props.messages.length === 0) {
    children.push(
      h('p', { class: 'cora-conversation-empty' }, 'No messages yet.')
    );
  } else {
    children.push(
      h(
        'ul',
        { class: 'cora-conversation-list' },
        ...props.messages.map((msg) => conversationMessage(msg))
      )
    );
  }

  if (props.access === 'edit') {
    children.push(conversationCompose(props.sendMessage));
  }
  return children;
}

/**
 * @param {Message} msg
 * @returns {HTMLElement}
 */
export function conversationMessage(msg) {
  return h(
    'li',
    { class: 'cora-conversation-message' },
    h('p', { class: 'cora-message-author' }, msg.author),
    h(
      'p',
      { class: 'cora-message-timestamp' },
      new Date(msg.timestamp).toLocaleString()
    ),
    h('p', { class: 'cora-message-body' }, msg.body)
  );
}

/**
 * @param {(body: string) => Promise<void>} sendMessage
 * @returns {HTMLElement}
 */
export function conversationCompose(sendMessage) {
  /** @type {HTMLTextAreaElement} */
  let textarea;
  return h(
    'div',
    { class: 'cora-conversation-compose' },
    (textarea = /** @type {HTMLTextAreaElement} */ (
      h('textarea', {
        class: 'cora-conversation-input',
        'aria-label': 'Message to Responsible Party',
      })
    )),
    h(
      'button',
      {
        class: 'cora-conversation-send',
        onclick: async () => {
          const body = (textarea.value ?? '').trim();
          if (!body) return;
          /** @type {any} */ (textarea).value = '';
          await sendMessage(body);
        },
      },
      'Send'
    )
  );
}

/**
 * @param {{ hidden?: boolean, addEventListener(type: string, listener: () => void): void, removeEventListener(type: string, listener: () => void): void }} target
 * @param {() => void | Promise<void>} refresh
 * @returns {{ handler: () => void, disconnect: () => void }}
 */
export function bindConversationVisibility(target, refresh) {
  const handler = () => {
    if (!target.hidden) refresh();
  };
  target.addEventListener('visibilitychange', handler);
  return {
    handler,
    disconnect: () => target.removeEventListener('visibilitychange', handler),
  };
}

/**
 * @param {{ client: SharePointClient | null, saveQueue: SaveQueue | null, caseId: string, currentUser: CurrentUser | null, messages: Message[], setMessages(messages: Message[]): void, render(): void }} context
 * @param {string} body
 * @returns {Promise<void>}
 */
export async function sendConversationMessage(context, body) {
  if (
    !context.client ||
    !context.saveQueue ||
    !context.caseId ||
    !context.currentUser
  ) {
    return;
  }

  /** @type {Message} */
  const msg = {
    author: context.currentUser.displayName,
    timestamp: new Date().toISOString(),
    body,
  };

  const messages = [...context.messages, msg];
  context.setMessages(messages);
  context.render();

  const etag = context.saveQueue.getEtag(context.caseId);
  const result = await context.client.patchCase(
    context.caseId,
    { conversation: messages },
    etag
  );

  if (result.ok && result.data) {
    context.saveQueue.loadCase(result.data);
  }
}

/**
 * @param {{ client: SharePointClient | null, caseId: string, setMessages(messages: Message[]): void, render(): void }} context
 * @returns {Promise<void>}
 */
export async function refreshConversation(context) {
  if (!context.client || !context.caseId) return;
  const fresh = await context.client.getCase(context.caseId);
  if (fresh) {
    context.setMessages(fresh.conversation);
    context.render();
  }
}

export class CORAConversation extends ShellElement {
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
    this._unbindVisibility = null;
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
      const binding = bindConversationVisibility(document, () =>
        this._refresh()
      );
      this._visibilityHandler = binding.handler;
      this._unbindVisibility = binding.disconnect;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unbindVisibility?.();
    this._unbindVisibility = null;
    this._visibilityHandler = null;
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
    return Conversation({
      messages: this._messages,
      access: this.access,
      sendMessage: (body) => this._sendMessage(body),
    });
  }

  /**
   * @param {string} body
   */
  async _sendMessage(body) {
    await sendConversationMessage(
      {
        client: this.client,
        saveQueue: this.saveQueue,
        caseId: this.caseId,
        currentUser: this.currentUser,
        messages: this._messages,
        setMessages: (messages) => {
          this._messages = messages;
        },
        render: () => this._render(),
      },
      body
    );
  }

  async _refresh() {
    await refreshConversation({
      client: this.client,
      caseId: this.caseId,
      setMessages: (messages) => {
        this._messages = messages;
      },
      render: () => this._render(),
    });
  }
}

customElements.define('cora-conversation', CORAConversation);
