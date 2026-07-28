// @ts-check
import { h } from '../lib/html.js';
import { LoadingState } from '../lib/empty-state.js';
import { ignoreAbortError, isAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { navigateTo } from '../lib/navigate.js';
import { patchRoute } from '../core/route-state.js';
import { CaseMachine } from '../lib/case-machine.js';
import {
  UnknownCaseTypeError,
  loadCaseTypeConfig,
} from '../../case-types/manifest.js';
import {
  conversationView,
  postConversationMessage,
  refreshConversation,
} from './cora-case-review/conversation-view.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */

/**
 * @typedef {Object} ConversationRouteState
 * @property {CaseRow | null} caseRow
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {CaseListOptions} caseListOptions
 * @property {string | null} error
 */

/**
 * @typedef {Object} ConversationState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ conversation: ConversationRouteState }} routes
 */

/**
 * @param {ConversationState} state
 * @param {{dispatch: (action: any) => any}} tools
 * @param {(body: string, state: ConversationState) => void|Promise<void>} send
 */
export function conversationPageView(state, tools, send) {
  const route = state.routes.conversation;
  if (route.error) return h('p', { role: 'alert' }, route.error);
  if (!route.caseRow) return LoadingState();

  return h(
    'div',
    { className: 'cora-conversation-view' },
    h(
      'header',
      { className: 'cora-conversation-view-header' },
      h(
        'button',
        {
          type: 'button',
          className: 'cora-back-btn',
          onclick: () => navigateTo('#/my-reviews'),
        },
        '← My Reviews'
      ),
      h('h1', {}, route.caseRow.title || route.caseRow.id)
    ),
    conversationView({
      messages: route.caseRow.conversation,
      access: route.access,
      heading: 'Conversation',
      onSend: (body) => send(body, state),
    })
  );
}

/**
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function createRouteSlice(params, context) {
  const currentUser = context.chrome.currentUser ?? context.currentUser;

  /** @param {string} body @param {ConversationState} state */
  async function send(
    /** @type {string} */ body,
    /** @type {ConversationState} */ state,
    /** @type {(action: any) => any} */ dispatch
  ) {
    const route = state.routes.conversation;
    if (
      route.access !== 'edit' ||
      !route.caseRow ||
      !currentUser ||
      !context.saveQueue
    ) {
      return;
    }
    await postConversationMessage({
      client: context.client,
      saveQueue: context.saveQueue,
      caseId: route.caseRow.id,
      messages: route.caseRow.conversation,
      currentUser,
      caseListOptions: route.caseListOptions,
      body,
      onMessages: (messages) =>
        dispatch({ type: 'conversation/messages-changed', messages }),
    });
  }

  return {
    initialState: /** @type {ConversationState} */ ({
      chrome: context.chrome,
      routes: {
        conversation: {
          caseRow: null,
          access: 'read-only',
          caseListOptions: {},
          error: null,
        },
      },
    }),
    /** @param {ConversationState} state @param {any} action */
    reducer(state, action) {
      const route = state.routes.conversation;
      if (action.type === 'conversation/loaded') {
        return patchRoute(state, 'conversation', {
          caseRow: action.caseRow,
          access: action.access,
          caseListOptions: action.caseListOptions,
        });
      }
      if (action.type === 'conversation/messages-changed' && route.caseRow) {
        return patchRoute(state, 'conversation', {
          caseRow: { ...route.caseRow, conversation: action.messages },
        });
      }
      if (action.type === 'conversation/load-failed') {
        return patchRoute(state, 'conversation', { error: action.message });
      }
      return state;
    },
    /** @param {Element} container @param {ConversationState} state @param {any} tools */
    render(container, state, tools) {
      tools.render(
        container,
        conversationPageView(state, tools, (body, currentState) =>
          send(body, currentState, tools.dispatch)
        )
      );
    },
    start(/** @type {any} */ tools) {
      /** @type {CaseListOptions} */
      let caseListOptions = {};
      // The mount lifetime bound to this route's reads, so navigating away
      // cancels the Case read rather than only discarding it (#567). Writes go
      // through `context.saveQueue`, which keeps the raw client (ADR-0008).
      const readClient = withAbortSignal(context.client, tools.signal);

      async function load() {
        try {
          let config = null;
          if (params.caseType) {
            config = await loadCaseTypeConfig(params.caseType);
            caseListOptions = config.listName
              ? { listName: config.listName }
              : {};
          }
          const caseRow = await readClient.getCase(params.id, caseListOptions);
          if (!caseRow || !tools.isActive()) return;
          config ??= await loadCaseTypeConfig(caseRow.caseType);
          const access = currentUser
            ? new CaseMachine(
                caseRow,
                { id: currentUser.id },
                context.chrome.permissions,
                config
              ).access.conversation
            : 'read-only';
          context.saveQueue?.loadCase(caseRow, caseListOptions);
          tools.dispatch({
            type: 'conversation/loaded',
            caseRow,
            access,
            caseListOptions,
          });
        } catch (error) {
          // An abort is navigation, never a load failure (#545) — and it is
          // stated rather than left to the isActive() latch below, so the
          // intent survives a future change to when the latch flips.
          if (isAbortError(error)) return;
          if (!tools.isActive()) return;
          if (error instanceof UnknownCaseTypeError) {
            tools.dispatch({
              type: 'conversation/load-failed',
              message: 'This Case Type is not supported.',
            });
            return;
          }
          throw error;
        }
      }

      void load();
      if (typeof document !== 'undefined') {
        tools.listen(document, 'visibilitychange', () => {
          if (document.hidden) return;
          void refreshConversation({
            client: readClient,
            caseId: params.id,
            caseListOptions,
          })
            .then((caseRow) => {
              if (tools.isActive() && caseRow) {
                tools.dispatch({
                  type: 'conversation/messages-changed',
                  messages: caseRow.conversation,
                });
              }
            })
            .catch(ignoreAbortError);
        });
      }
    },
  };
}
