// @ts-check
import { h } from '../lib/html.js';
import { ignoreAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { setRoute } from '../core/route-state.js';
import { listCasesAcrossSources } from '../services/across-sources.js';
import {
  initialResponsiblePartyState,
  reduceResponsibleParty,
  responsiblePartyPanelView,
} from './cora-responsible-party-dashboard.js';

/** @typedef {import('./cora-responsible-party-dashboard.js').ResponsiblePartyRouteState} FrontlineCasesRouteState */
/** @typedef {{ chrome: import('../core/chrome-state.js').ChromeState, routes: { frontlineCases: FrontlineCasesRouteState } }} FrontlineCasesState */

/**
 * The frontline team's queue: the same outstanding Remediation Actions and
 * unread Messages a Responsible Party sees on My Cases, drawn from every Case of
 * the Case Types whose team the viewer is in. My Cases cannot serve them,
 * because it finds a Case by the person named on it, and these Case Types name
 * nobody — the team is the recipient, so every Case of the type is theirs.
 *
 * @param {FrontlineCasesState} state
 * @param {{ dispatch: (action: any) => any }} tools
 */
export function frontlineCasesView(state, tools) {
  return h(
    'div',
    { className: 'cora-frontline-cases' },
    h('h1', {}, 'Frontline Cases'),
    // A team member arrives here to act on a Case, so a Message row opens the
    // Case it belongs to rather than staying on the list.
    responsiblePartyPanelView(state.routes.frontlineCases, tools, {
      navigateToConversation: true,
    })
  );
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
  return {
    initialState: {
      chrome: context.chrome,
      routes: {
        frontlineCases: initialResponsiblePartyState(
          context.chrome.currentUser.id
        ),
      },
    },
    reducer(
      /** @type {FrontlineCasesState} */ state,
      /** @type {any} */ action
    ) {
      const next = reduceResponsibleParty(state.routes.frontlineCases, action);
      if (next === state.routes.frontlineCases) return state;
      return setRoute(state, 'frontlineCases', next);
    },
    view: frontlineCasesView,
    start(/** @type {any} */ tools) {
      if (!tools.context.client) return;
      // No person filter: membership of the team is what made these sources
      // the viewer's, and it covers every Case on them. The signal cancels the
      // per-source fan-out on navigation; isActive() stops a late dispatch.
      void listAcrossSources(
        withAbortSignal(tools.context.client, tools.signal),
        tools.context.frontlineCaseSources,
        {}
      )
        .then((cases) => {
          if (tools.isActive())
            tools.dispatch({ type: 'responsible-party/loaded', cases });
        })
        .catch(ignoreAbortError);
    },
  };
}
