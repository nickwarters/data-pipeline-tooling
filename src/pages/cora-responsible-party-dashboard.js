// @ts-check
import { ignoreAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { setRoute } from '../core/route-state.js';
import { conversationRouteFor } from '../lib/case-route-links.js';
import { navigateTo } from '../lib/navigate.js';
import { listCasesAcrossSources } from '../services/across-sources.js';
import { reduceTableSort, sortRequested } from '../views/data-table.js';
import { responsiblePartyView } from './responsible-party/view.js';

/** The two table names this panel sorts by: used by both the view and the reducer. */
const REMEDIATION_TABLE = 'remediation';
const UNREAD_TABLE = 'unread';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {ReturnType<typeof initialResponsiblePartyState>} ResponsiblePartyRouteState */
/** @typedef {{ chrome: import('../core/chrome-state.js').ChromeState, routes: { responsibleParty: ResponsiblePartyRouteState } }} ResponsiblePartyState */

/** @param {string} currentUserId */
export function initialResponsiblePartyState(currentUserId) {
  return {
    cases: /** @type {CaseRow[]} */ ([]),
    currentUserId,
    filter: '',
    remediationSort:
      /** @type {import('../views/data-table.js').TableSort | null} */ ({
        key: 'remediationDueDate',
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
  const remediationSort = reduceTableSort(
    state.remediationSort,
    action,
    REMEDIATION_TABLE
  );
  if (remediationSort) return { ...state, remediationSort };
  const messageSort = reduceTableSort(state.messageSort, action, UNREAD_TABLE);
  if (messageSort) return { ...state, messageSort };
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
      tools.dispatch(sortRequested(REMEDIATION_TABLE, key)),
    onMessageSort: (key) => tools.dispatch(sortRequested(UNREAD_TABLE, key)),
    onOpenConversation: navigateToConversation
      ? (row) => navigateTo(conversationRouteFor(row))
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
    reducer(
      /** @type {ResponsiblePartyState} */ state,
      /** @type {any} */ action
    ) {
      const next = reduceResponsibleParty(
        state.routes.responsibleParty,
        action
      );
      if (next === state.routes.responsibleParty) return state;
      return setRoute(state, 'responsibleParty', next);
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
      // The signal cancels the per-source fan-out on navigation; the
      // isActive() guard still stops a late dispatch (#545 / #517).
      void listAcrossSources(
        withAbortSignal(client, tools.signal),
        tools.context.caseSources,
        { responsibleParty: currentUserId }
      )
        .then((cases) => {
          if (tools.isActive())
            tools.dispatch({ type: 'responsible-party/loaded', cases });
        })
        .catch(ignoreAbortError);
    },
  };
}
