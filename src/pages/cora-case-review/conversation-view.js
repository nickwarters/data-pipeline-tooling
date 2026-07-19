// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';

/** @typedef {import('../../sharepoint-client.js').Message} Message */
/** @typedef {import('../../sharepoint-client.js').CaseListOptions} CaseListOptions */

/**
 * @param {{
 *   messages: Message[],
 *   access: 'edit'|'read-only'|'hidden',
 *   heading: string,
 *   onSend: (body: string) => void|Promise<void>,
 * }} props
 */
export function conversationView(props) {
  return h(
    'section',
    { className: 'cora-conversation-panel' },
    h('h2', {}, props.heading),
    props.messages.length
      ? h(
          'ul',
          { className: 'cora-conversation-list' },
          ...props.messages.map((message) =>
            h(
              'li',
              { className: 'cora-conversation-message' },
              h('p', { className: 'cora-message-author' }, message.author),
              h(
                'p',
                { className: 'cora-message-timestamp' },
                new Date(message.timestamp).toLocaleString()
              ),
              h('p', { className: 'cora-message-body' }, message.body)
            )
          )
        )
      : EmptyState('No messages yet.', {
          className: 'cora-conversation-empty',
        }),
    props.access === 'edit' ? conversationCompose(props.onSend) : null
  );
}

/** @param {(body: string) => void|Promise<void>} onSend */
function conversationCompose(onSend) {
  /** @type {HTMLTextAreaElement} */
  let textarea;
  return h(
    'div',
    { className: 'cora-conversation-compose' },
    (textarea = /** @type {HTMLTextAreaElement} */ (
      h('textarea', {
        className: 'cora-conversation-input',
        'aria-label': 'Message to Responsible Party',
      })
    )),
    h(
      'button',
      {
        className: 'cora-conversation-send',
        'aria-label': 'Send message',
        onClick: async () => {
          const body = (textarea.value ?? '').trim();
          if (!body) return;
          textarea.value = '';
          await onSend(body);
        },
      },
      'Send'
    )
  );
}

/**
 * Preserve the existing JSON-blob PATCH path and ETag ownership while the UI
 * moves to store actions.
 *
 * @param {{
 *   client: import('../../sharepoint-client.js').SharePointClient,
 *   saveQueue: import('../../services/save-queue.js').SaveQueue,
 *   caseId: string,
 *   messages: Message[],
 *   currentUser: import('../../sharepoint-client.js').CurrentUser,
 *   caseListOptions: CaseListOptions,
 *   body: string,
 *   onMessages?: (messages: Message[]) => void,
 * }} input
 */
export async function postConversationMessage(input) {
  const message = {
    author: input.currentUser.displayName,
    timestamp: new Date().toISOString(),
    body: input.body,
  };
  const messages = [...input.messages, message];
  input.onMessages?.(messages);
  const result = await input.client.patchCase(
    input.caseId,
    { conversation: messages },
    input.saveQueue.getEtag(input.caseId),
    input.caseListOptions
  );
  if (result.ok && result.data) {
    input.saveQueue.loadCase(result.data, input.caseListOptions);
  }
  return { messages, result };
}

/**
 * @param {{
 *   client: import('../../sharepoint-client.js').SharePointClient,
 *   caseId: string,
 *   caseListOptions: CaseListOptions,
 * }} input
 */
export function refreshConversation(input) {
  return input.client.getCase(input.caseId, input.caseListOptions);
}
