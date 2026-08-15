// @ts-check
import { h } from '../lib/html.js';
import { EmptyState, LoadingState, NO_DATA_YET } from '../lib/empty-state.js';
import { patchRoute } from '../core/route-state.js';
import { isAbortError } from '../lib/abort.js';
import { loadReportFeed } from '../services/report-feed-loader.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { buildStatsRanges } from '../evaluators/stats-range-model.js';
import {
  buildStatsReport,
  countCasesByLocalDateAndType,
} from '../evaluators/stats-report-model.js';
import {
  fetchLiveTailCases,
  liveTailWindow,
  LIVE_TAIL_MAX_DAYS,
} from '../services/live-tail-fetcher.js';
import { isDateKey, shiftDateKey } from '../lib/local-calendar.js';
import { mountGroupedBarChartTooltip } from '../lib/chart-tooltip.js';
import { headlineStripView } from './my-stats/headline-strip-view.js';
import { statsChartView } from './my-stats/stats-chart-view.js';
import { statsBreakdownTableView } from './my-stats/stats-breakdown-table-view.js';

export const COPY = Object.freeze({
  loadingSubject: 'Loading your report',
  noReport: 'No report has been published for you yet.',
  noDataYet: NO_DATA_YET,
});

/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */
/** @typedef {import('../services/report-feed-loader.js').ReportFeedEnvelope} ReportFeedEnvelope */
/** @typedef {import('../evaluators/stats-range-model.js').StatsRangeDescriptor} StatsRangeDescriptor */
/** @typedef {import('../evaluators/stats-range-model.js').StatsRangeKey} StatsRangeKey */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */

/**
 * What the live read of the unpublished days has done so far.
 *
 * `idle` is a real answer and not a placeholder: with no report published there
 * is nothing to top up, so no request is issued at all. `from` is the earliest
 * calendar date the read actually covered, which is how the page knows whether
 * the clamp cut the window short of the report's own edge.
 *
 * @typedef {Object} MyStatsTailState
 * @property {'idle' | 'loading' | 'loaded' | 'failed'} status
 * @property {string | null} from
 * @property {Record<string, Record<string, number>>} typedCounts
 */

/**
 * `feedStatus` exists because `reportFeed: null` answers two different
 * questions with the same value — "nobody has published a report for you" and
 * "we have not looked yet" — and the page owes the Reviewer different words for
 * each.
 *
 * @typedef {Object} MyStatsRouteState
 * @property {'loading' | 'loaded' | 'failed'} feedStatus
 * @property {ReportFeedEnvelope | null} reportFeed
 * @property {StatsRangeDescriptor[]} ranges
 * @property {StatsRangeKey} selectedRange
 * @property {MyStatsTailState} tail
 */

/**
 * @typedef {Object} MyStatsState
 * @property {ChromeState} chrome
 * @property {{ myStats: MyStatsRouteState }} routes
 */

/**
 * A quiet line under the figures when the page knows its recent days are
 * incomplete. It never replaces or hides the published half: those numbers are
 * settled and stay on screen whatever the live read did.
 *
 * @param {MyStatsTailState} tail
 * @param {string} firstUnpublishedDate the first calendar date the published
 *   report does not cover, which is where a complete live read would start
 * @returns {HTMLElement | null}
 */
function tailNoticeView(tail, firstUnpublishedDate) {
  if (tail.status === 'failed') {
    return h(
      'p',
      { className: 'cora-my-stats-tail-note' },
      'The last few days could not be counted just now, so recent work may be missing from this page.'
    );
  }
  if (tail.from !== null && tail.from > firstUnpublishedDate) {
    return h(
      'p',
      { className: 'cora-my-stats-tail-note' },
      `Only the last ${LIVE_TAIL_MAX_DAYS} days of unpublished work are counted here, and your published report ends further back than that — the days in between are missing from this page.`
    );
  }
  return null;
}

/**
 * @param {MyStatsRouteState} route
 * @param {(action: { type: 'my-stats/range-selected', range: StatsRangeKey }) => void} dispatch
 * @returns {HTMLElement}
 */
function rangeControlsView(route, dispatch) {
  return h(
    'div',
    {
      className: 'cora-my-stats-range-controls',
      role: 'group',
      'aria-label': 'Stats range',
    },
    route.ranges.map((range) =>
      h(
        'button',
        {
          className: 'cora-my-stats-range-button',
          type: 'button',
          'aria-pressed': range.key === route.selectedRange,
          onclick: () =>
            dispatch({
              type: 'my-stats/range-selected',
              range: range.key,
            }),
        },
        range.label
      )
    )
  );
}

/**
 * @param {MyStatsRouteState} route
 * @param {(action: { type: 'my-stats/range-selected', range: StatsRangeKey }) => void} dispatch
 * @returns {HTMLElement | (HTMLElement | null)[]}
 */
function bodyView(route, dispatch) {
  if (route.feedStatus === 'loading') return LoadingState(COPY.loadingSubject);
  if (route.feedStatus === 'failed') {
    return h(
      'p',
      { className: 'cora-my-stats-error', role: 'alert' },
      'Your report could not be loaded. Try again shortly.'
    );
  }

  const range = route.ranges.find(({ key }) => key === route.selectedRange);
  if (!range) {
    return EmptyState(COPY.noDataYet, { className: 'cora-my-stats-empty' });
  }
  // A report that was never published is not an empty one. Saying "no data"
  // here would tell a Reviewer they did nothing, when what happened is that
  // nothing has been written for them yet — and with nothing published there is
  // no boundary to compute a live tail from, so none is read.
  if (route.reportFeed === null) {
    return EmptyState(COPY.noReport, {
      className: 'cora-my-stats-no-report',
    });
  }

  // The report is a published file, so its boundary date is checked before
  // anything is built on it. Unreadable means nothing is settled, which is the
  // safe reading: the page then shows every day as counted-in-the-browser
  // rather than claiming a file covered days it may not have.
  const completeThrough = isDateKey(route.reportFeed.complete_through)
    ? route.reportFeed.complete_through
    : null;

  // Derived once. The chart, figures, and table are three readings of the same
  // numbers, and a second derivation is how they would come to disagree.
  const report = buildStatsReport({
    range,
    completeThrough,
    feedRows: route.reportFeed.rows,
    liveTypedCounts: route.tail.typedCounts,
  });

  return [
    h(
      'div',
      { className: 'cora-my-stats-top-row' },
      h(
        'div',
        { className: 'cora-my-stats-controls-column' },
        rangeControlsView(route, dispatch)
      ),
      statsChartView(report)
    ),
    headlineStripView(report.headline),
    statsBreakdownTableView(report),
    tailNoticeView(
      route.tail,
      // With no usable boundary every day on the page is unpublished, so the
      // first unpublished date is earlier than any date key there is.
      completeThrough === null ? '' : shiftDateKey(completeThrough, 1)
    ),
  ];
}

/**
 * @param {MyStatsState} state
 * @param {(action: { type: 'my-stats/range-selected', range: StatsRangeKey }) => void} [dispatch]
 * @returns {HTMLElement}
 */
export function myStatsView(state, dispatch = () => {}) {
  const route = state.routes.myStats;
  return h(
    'main',
    {
      className: 'cora-my-stats',
      'aria-busy': String(
        route.feedStatus === 'loading' || route.tail.status === 'loading'
      ),
    },
    h('h1', {}, 'My Stats'),
    bodyView(route, dispatch)
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{
 *   loadReportFeed?: typeof loadReportFeed,
 *   fetchTailCases?: typeof fetchLiveTailCases,
 *   now?: () => Date,
 * }} [dependencies]
 * @returns {{
 *   initialState: MyStatsState,
 *   reducer: (state: MyStatsState, action: any) => MyStatsState,
 *   render: (container: Element, state: MyStatsState, tools: { render: (container: Element, view: Node) => void, dispatch: (action: any) => void, context: import('../setup/register-routes.js').AppContext }) => void,
 *   start: (tools: { dispatch: (action: unknown) => void, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean, signal: AbortSignal }) => (() => void),
 * }}
 */
export function createRouteSlice(
  _params,
  context,
  {
    loadReportFeed: load = loadReportFeed,
    fetchTailCases = fetchLiveTailCases,
    now = () => new Date(),
  } = {}
) {
  const ranges = buildStatsRanges(now());
  // The ranges already hold the browser-local calendar date the page was opened
  // on, so the tail window is measured from the same snapshot the chart is.
  const todayKey = ranges[0].today;
  /** @type {SVGSVGElement|null} */
  let chartSvg = null;
  /** @type {ReturnType<typeof mountGroupedBarChartTooltip>|null} */
  let tooltipController = null;

  /**
   * Top up the published report with the days it cannot cover yet.
   *
   * @param {{ dispatch: (action: unknown) => void, context: import('../setup/register-routes.js').AppContext, isActive: () => boolean }} tools
   * @param {SharePointClient} client already bound to the mount lifetime
   * @param {string} completeThrough
   */
  function loadTail(tools, client, completeThrough) {
    const tailWindow = liveTailWindow(completeThrough, todayKey);
    if (tailWindow === null) {
      tools.dispatch({
        type: 'my-stats/tail-loaded',
        from: null,
        typedCounts: {},
      });
      return;
    }
    tools.dispatch({ type: 'my-stats/tail-requested' });
    // Started inside the chain: a mount with no client throws where the fetcher
    // first touches it, and that belongs in the rejection handler rather than
    // out of start(), where it would take the whole route down.
    void Promise.resolve()
      .then(() =>
        fetchTailCases(
          client,
          tools.context.chrome.currentUser.id,
          tools.context.caseSources,
          tailWindow
        )
      )
      .then(
        (rows) => {
          if (!tools.isActive()) return;
          const typedCounts = countCasesByLocalDateAndType(rows);
          tools.dispatch({
            type: 'my-stats/tail-loaded',
            from: tailWindow.from,
            typedCounts,
          });
        },
        (error) => {
          if (isAbortError(error) || !tools.isActive()) return;
          tools.dispatch({ type: 'my-stats/tail-failed' });
        }
      );
  }

  return {
    initialState: {
      chrome: context.chrome,
      routes: {
        myStats: {
          feedStatus: 'loading',
          reportFeed: null,
          ranges,
          selectedRange: 'week',
          tail: { status: 'idle', from: null, typedCounts: {} },
        },
      },
    },
    reducer(state, action) {
      if (action.type === 'report-feed/loaded') {
        return patchRoute(state, 'myStats', {
          feedStatus: 'loaded',
          reportFeed: action.reportFeed,
        });
      }
      if (action.type === 'report-feed/failed') {
        return patchRoute(state, 'myStats', { feedStatus: 'failed' });
      }
      if (action.type === 'my-stats/tail-requested') {
        return patchRoute(state, 'myStats', {
          tail: { status: 'loading', from: null, typedCounts: {} },
        });
      }
      if (action.type === 'my-stats/tail-loaded') {
        return patchRoute(state, 'myStats', {
          tail: {
            status: 'loaded',
            from: action.from,
            typedCounts: action.typedCounts,
          },
        });
      }
      if (action.type === 'my-stats/tail-failed') {
        return patchRoute(state, 'myStats', {
          tail: { status: 'failed', from: null, typedCounts: {} },
        });
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
      tools.render(container, myStatsView(state, tools.dispatch));

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
      // One binding, in one place: the mount lifetime is attached to the client
      // here, so every read below it — including the per-Case-Type fan-out —
      // is cancelled by navigation without a single fetcher knowing about it.
      // The Report Feed is not a client read; it is a document-library fetch,
      // and carries the same signal through its own options bag.
      const client = tools.context.client
        ? withAbortSignal(tools.context.client, tools.signal)
        : tools.context.client;

      // Two-argument `then`, not `then().catch()`: the rejection handler is for
      // the read that failed, and must not also swallow whatever the success
      // path goes on to do.
      void load(tools.context.chrome.currentUser.id, {
        signal: tools.signal,
      }).then(
        (reportFeed) => {
          if (!tools.isActive()) return;
          tools.dispatch({ type: 'report-feed/loaded', reportFeed });
          if (reportFeed === null) return;
          loadTail(tools, client, reportFeed.complete_through);
        },
        (error) => {
          if (isAbortError(error) || !tools.isActive()) return;
          tools.dispatch({ type: 'report-feed/failed' });
        }
      );

      return () => {
        tooltipController?.dispose();
        tooltipController = null;
        chartSvg = null;
      };
    },
  };
}
