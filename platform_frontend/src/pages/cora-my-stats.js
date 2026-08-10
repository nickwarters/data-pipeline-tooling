// @ts-check
import { h } from '../lib/html.js';
import { EmptyState } from '../lib/empty-state.js';
import { GroupedBarChart } from '../components/base/cora-grouped-bar-chart.js';
import { patchRoute } from '../core/route-state.js';
import { ignoreAbortError } from '../lib/abort.js';
import { loadReportFeed } from '../services/report-feed-loader.js';
import { buildStatsRanges } from '../evaluators/stats-range-model.js';
import { mountGroupedBarChartTooltip } from '../lib/chart-tooltip.js';

/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */
/** @typedef {import('../components/base/cora-grouped-bar-chart.js').GroupedBarChartData} GroupedBarChartData */
/** @typedef {import('../components/base/cora-grouped-bar-chart.js').GroupedBarChartConfig} GroupedBarChartConfig */
/** @typedef {import('../services/report-feed-loader.js').ReportFeedEnvelope} ReportFeedEnvelope */
/** @typedef {import('../evaluators/stats-range-model.js').StatsRangeDescriptor} StatsRangeDescriptor */
/** @typedef {import('../evaluators/stats-range-model.js').StatsRangeKey} StatsRangeKey */

/** @typedef {{ data: GroupedBarChartData, config: GroupedBarChartConfig }} MyStatsChart */

/**
 * @typedef {Object} MyStatsRouteState
 * @property {ReportFeedEnvelope | null} reportFeed
 * @property {StatsRangeDescriptor[]} ranges
 * @property {StatsRangeKey} selectedRange
 * @property {MyStatsChart} [chart]
 */

/**
 * @typedef {Object} MyStatsState
 * @property {ChromeState} chrome
 * @property {{ myStats: MyStatsRouteState }} routes
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
 * @param {{ loadReportFeed?: typeof loadReportFeed, now?: () => Date }} [dependencies]
 * @returns {{
 *   initialState: MyStatsState,
 *   reducer: (state: MyStatsState, action: any) => MyStatsState,
 *   render: (container: Element, state: MyStatsState, tools: { render: (container: Element, view: Node) => void, context: import('../setup/register-routes.js').AppContext }) => void,
 *   start: (tools: { dispatch: (action: unknown) => void, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean, signal: AbortSignal }) => (() => void),
 * }}
 */
export function createRouteSlice(
  _params,
  context,
  { loadReportFeed: load = loadReportFeed, now = () => new Date() } = {}
) {
  const ranges = buildStatsRanges(now());
  /** @type {SVGSVGElement|null} */
  let chartSvg = null;
  /** @type {ReturnType<typeof mountGroupedBarChartTooltip>|null} */
  let tooltipController = null;

  return {
    initialState: {
      chrome: context.chrome,
      routes: {
        myStats: { reportFeed: null, ranges, selectedRange: 'week' },
      },
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
      if (action.type === 'my-stats/range-selected') {
        const range = state.routes.myStats.ranges.find(
          ({ key }) => key === action.range
        );
        if (!range) return state;
        return patchRoute(state, 'myStats', { selectedRange: range.key });
      }
      return state;
    },
    render(container, state, tools) {
      tools.render(container, myStatsView(state));

      const chart = /** @type {SVGSVGElement|null} */ (
        container.querySelector('svg.cora-grouped-bar-chart')
      );
      if (chart !== chartSvg) {
        tooltipController?.dispose();
        tooltipController = null;
        chartSvg = chart;
        if (chart) {
          tooltipController = mountGroupedBarChartTooltip(chart, {
            host: tools.context.appEl,
          });
        }
      }
      tooltipController?.refresh();
    },
    start(tools) {
      void load(tools.context.chrome.currentUser.id, { signal: tools.signal })
        .then((reportFeed) => {
          if (tools.isActive()) {
            tools.dispatch({ type: 'report-feed/loaded', reportFeed });
          }
        })
        .catch(ignoreAbortError);
      return () => {
        tooltipController?.dispose();
        tooltipController = null;
        chartSvg = null;
      };
    },
  };
}
