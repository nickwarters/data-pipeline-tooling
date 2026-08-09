// @ts-check
import { h } from '../lib/html.js';
import { EmptyState } from '../lib/empty-state.js';
import { GroupedBarChart } from '../components/base/cora-grouped-bar-chart.js';
import { patchRoute } from '../core/route-state.js';
import { ignoreAbortError } from '../lib/abort.js';
import { loadReportFeed } from '../services/report-feed-loader.js';

/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */
/** @typedef {import('../components/base/cora-grouped-bar-chart.js').GroupedBarChartData} GroupedBarChartData */
/** @typedef {import('../components/base/cora-grouped-bar-chart.js').GroupedBarChartConfig} GroupedBarChartConfig */
/** @typedef {import('../services/report-feed-loader.js').ReportFeedEnvelope} ReportFeedEnvelope */

/** @typedef {{ data: GroupedBarChartData, config: GroupedBarChartConfig }} MyStatsChart */

/** @typedef {{ chart?: MyStatsChart }} MyStatsRouteState */

/**
 * @typedef {Object} MyStatsState
 * @property {ChromeState} chrome
 * @property {{ myStats: MyStatsRouteState & { reportFeed: ReportFeedEnvelope | null } }} routes
 */

/**
 * @param {MyStatsState} state
 * @returns {HTMLElement}
 */
export function myStatsView(state) {
  const chart = state.routes.myStats.chart;
  return h(
    'main',
    { className: 'cora-my-stats' },
    h('h1', {}, 'My Stats'),
    chart
      ? GroupedBarChart(chart)
      : EmptyState('No data yet.', { className: 'cora-my-stats-empty' })
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
      if (action.type === 'my-stats/chart-loaded') {
        return patchRoute(state, 'myStats', { chart: action.chart });
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
