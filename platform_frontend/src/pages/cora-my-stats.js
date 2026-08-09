// @ts-check
import { h } from '../lib/html.js';
import { EmptyState } from '../lib/empty-state.js';
import { patchRoute } from '../core/route-state.js';
import { ignoreAbortError } from '../lib/abort.js';
import { loadReportFeed } from '../services/report-feed-loader.js';

/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */

/**
 * @typedef {Object} MyStatsState
 * @property {ChromeState} chrome
 * @property {{ myStats: { reportFeed: import('../services/report-feed-loader.js').ReportFeedEnvelope | null } }} routes
 */

/**
 * @param {MyStatsState} _state
 * @returns {HTMLElement}
 */
export function myStatsView(_state) {
  return h(
    'main',
    { className: 'cora-my-stats' },
    h('h1', {}, 'My Stats'),
    EmptyState('No data yet.', { className: 'cora-my-stats-empty' })
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ loadReportFeed?: typeof loadReportFeed }} [dependencies]
 * @returns {{
 *   initialState: MyStatsState,
 *   reducer: (state: MyStatsState, action: any) => MyStatsState,
 *   view: (state: MyStatsState) => HTMLElement,
 *   start: (tools: { dispatch: (action: unknown) => void, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean, signal: AbortSignal }) => void,
 * }}
 */
export function createRouteSlice(
  _params,
  context,
  { loadReportFeed: load = loadReportFeed } = {}
) {
  return {
    initialState: {
      chrome: context.chrome,
      routes: { myStats: { reportFeed: null } },
    },
    reducer(state, action) {
      if (action.type === 'report-feed/loaded') {
        return patchRoute(state, 'myStats', {
          reportFeed: action.reportFeed,
        });
      }
      return state;
    },
    view: myStatsView,
    start(tools) {
      void load(tools.context.chrome.currentUser.id, { signal: tools.signal })
        .then((reportFeed) => {
          if (tools.isActive()) {
            tools.dispatch({ type: 'report-feed/loaded', reportFeed });
          }
        })
        .catch(ignoreAbortError);
    },
  };
}
