// @ts-check
import { conversationRouteFor } from '../lib/case-route-links.js';
import { listCasesAcrossSources } from '../services/across-sources.js';
import { nextTableSort } from '../views/data-table.js';
import { responsiblePartyView } from './responsible-party/view.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/** @param {string} currentUserId */
export function initialResponsiblePartyState(currentUserId) {
  return {
    cases: /** @type {CaseRow[]} */ ([]),
    currentUserId,
    filter: '',
    remediationSort:
      /** @type {import('../views/data-table.js').TableSort | null} */ ({
        key: 'dueDate',
        dir: 'asc',
      }),
    messageSort:
      /** @type {import('../views/data-table.js').TableSort | null} */ ({
        key: 'lastMessage',
        dir: 'desc',
      }),
  };
}

/** @param {ReturnType<typeof initialResponsiblePartyState>} state @param {any} action */
export function reduceResponsibleParty(state, action) {
  if (action.type === 'responsible-party/loaded') {
    return { ...state, cases: action.cases };
  }
  if (action.type === 'responsible-party/filter-changed') {
    return { ...state, filter: action.value };
  }
  if (action.type === 'responsible-party/remediation-sort-requested') {
    return {
      ...state,
      remediationSort: nextTableSort(state.remediationSort, action.key),
    };
  }
  if (action.type === 'responsible-party/message-sort-requested') {
    return {
      ...state,
      messageSort: nextTableSort(state.messageSort, action.key),
    };
  }
  return state;
}

/**
 * @param {ReturnType<typeof initialResponsiblePartyState>} state
 * @param {{ dispatch: (action: any) => any }} tools
 * @param {{ navigateToConversation?: boolean }} [options]
 */
export function responsiblePartyPanelView(
  state,
  tools,
  { navigateToConversation = false } = {}
) {
  return responsiblePartyView(state, {
    onFilterChange: (value) =>
      tools.dispatch({ type: 'responsible-party/filter-changed', value }),
    onRemediationSort: (key) =>
      tools.dispatch({
        type: 'responsible-party/remediation-sort-requested',
        key,
      }),
    onMessageSort: (key) =>
      tools.dispatch({ type: 'responsible-party/message-sort-requested', key }),
    onOpenConversation: navigateToConversation
      ? (row) => {
          location.hash = conversationRouteFor(row);
        }
      : undefined,
  });
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ listAcrossSources?: typeof listCasesAcrossSources }} [dependencies]
 */
export function createRouteSlice(
  _params,
  context,
  { listAcrossSources = listCasesAcrossSources } = {}
) {
  const initialState = {
    chrome: context.chrome,
    routes: {
      responsibleParty: initialResponsiblePartyState(
        context.chrome.currentUser.id
      ),
    },
  };
  return {
    initialState,
    reducer(/** @type {any} */ state, /** @type {any} */ action) {
      const next = reduceResponsibleParty(
        state.routes.responsibleParty,
        action
      );
      if (next === state.routes.responsibleParty) return state;
      return { ...state, routes: { responsibleParty: next } };
    },
    view(/** @type {any} */ state, /** @type {any} */ tools) {
      // The standalone #/my-cases route intentionally keeps the historic
      // no-navigation Open behaviour. The embedded dashboard opts in.
      return responsiblePartyPanelView(state.routes.responsibleParty, tools);
    },
    start(/** @type {any} */ tools) {
      const client = tools.context.client;
      const currentUserId = tools.context.chrome.currentUser.id;
      if (!client || !currentUserId) return;
      void listAcrossSources(client, tools.context.caseSources, {
        responsibleParty: currentUserId,
      }).then((cases) => {
        if (tools.isActive())
          tools.dispatch({ type: 'responsible-party/loaded', cases });
      });
    },
  };
}
