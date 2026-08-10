// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeChrome } from './helpers/fixtures.js';

installDom();

const { createRouteSlice, myStatsView } =
  await import('../src/pages/cora-my-stats.js');
const { buildStatsRanges } =
  await import('../src/evaluators/stats-range-model.js');

const FIXED_NOW = new Date(2026, 7, 10, 12);

/** @param {Record<string, unknown>} [overrides] */
function dependencies(overrides = {}) {
  return { now: () => new Date(FIXED_NOW), ...overrides };
}
const { render } = await import('../src/core/render.js');

/** @param {any} [client] */
function context(client = {}) {
  return /** @type {any} */ ({
    client,
    chrome: makeChrome(),
    appEl: document.createElement('div'),
  });
}

test('my stats view: renders an accessible heading and the empty state copy', () => {
  const view = myStatsView(
    /** @type {any} */ ({
      chrome: makeChrome(),
      routes: { myStats: { reportFeed: null } },
    })
  );

  assert.equal(view.tagName, 'MAIN');
  assert.equal(view.querySelector('h1')?.textContent, 'My Stats');
  const empty = view.querySelector('.cora-my-stats-empty');
  assert.ok(empty);
  assert.equal(empty.textContent, 'No data yet.');
});

test('my stats view: renders supplied chart data and omits the fallback', () => {
  const view = myStatsView(
    /** @type {any} */ ({
      chrome: makeChrome(),
      routes: {
        myStats: {
          chart: {
            data: {
              groups: [
                {
                  key: 'week-one',
                  label: 'Week one',
                  marks: [{ key: 'settled', label: 'Settled', value: 4 }],
                },
              ],
            },
            config: {
              width: 240,
              height: 160,
              ariaLabel: 'Review counts',
            },
          },
        },
      },
    })
  );

  assert.equal(view.querySelector('.cora-my-stats-empty'), null);
  const chart = /** @type {any} */ (
    Array.from(view.childNodes).find(
      (/** @type {any} node */ node) => node.tagName === 'svg'
    )
  );
  assert.ok(chart);
  assert.equal(chart.getAttribute('aria-label'), 'Review counts');
});

test('my stats slice: keeps shared chrome and starts with no Report Feed', () => {
  const chrome = makeChrome();
  const slice = createRouteSlice({}, { ...context(), chrome }, dependencies());

  assert.equal(slice.initialState.chrome, chrome);
  assert.deepEqual(slice.initialState.routes.myStats, {
    reportFeed: null,
    ranges: buildStatsRanges(FIXED_NOW),
    selectedRange: 'week',
  });
  assert.equal(
    slice.reducer(slice.initialState, { type: 'ignored' }),
    slice.initialState
  );
});

test('my stats slice: accepts a chart view model without mapping the Report Feed', () => {
  const slice = createRouteSlice({}, context(), dependencies());
  const chart = {
    data: {
      groups: [
        {
          key: 'week-one',
          label: 'Week one',
          marks: [{ key: 'settled', label: 'Settled', value: 4 }],
        },
      ],
    },
    config: {
      width: 240,
      height: 160,
      ariaLabel: 'Review counts',
    },
  };

  const next = slice.reducer(slice.initialState, {
    type: 'my-stats/chart-loaded',
    chart,
  });

  assert.equal(next.routes.myStats.chart, chart);
  assert.equal(next.routes.myStats.reportFeed, null);
});

test('my stats slice: accepts every range in the snapshot', () => {
  const slice = createRouteSlice({}, context(), dependencies());

  for (const range of ['week', 'month', '3-months', '12-months']) {
    const next = slice.reducer(slice.initialState, {
      type: 'my-stats/range-selected',
      range,
    });
    assert.equal(next.routes.myStats.selectedRange, range);
  }
});

test('my stats slice: ignores a range outside the snapshot', () => {
  const slice = createRouteSlice({}, context(), dependencies());

  assert.equal(
    slice.reducer(slice.initialState, {
      type: 'my-stats/range-selected',
      range: 'quarter',
    }),
    slice.initialState
  );
});

test('my stats slice: range selection preserves all other state', () => {
  const chrome = makeChrome();
  const slice = createRouteSlice({}, { ...context(), chrome }, dependencies());
  const chart = {
    data: {
      groups: [
        {
          key: 'week-one',
          label: 'Week one',
          marks: [{ key: 'settled', label: 'Settled', value: 4 }],
        },
      ],
    },
    config: { width: 240, height: 160, ariaLabel: 'Review counts' },
  };
  const state = /** @type {any} */ ({
    ...slice.initialState,
    routes: {
      ...slice.initialState.routes,
      myStats: {
        ...slice.initialState.routes.myStats,
        reportFeed: envelope,
        chart,
        futureField: 'preserved',
      },
      sibling: { value: 1 },
    },
  });

  const next = slice.reducer(state, {
    type: 'my-stats/range-selected',
    range: 'month',
  });
  const preserved = /** @type {any} */ (next);

  assert.equal(next.chrome, chrome);
  assert.equal(next.routes.myStats.reportFeed, envelope);
  assert.equal(next.routes.myStats.chart, chart);
  assert.equal(next.routes.myStats.ranges, state.routes.myStats.ranges);
  assert.equal(preserved.routes.myStats.futureField, 'preserved');
  assert.equal(preserved.routes.sibling, state.routes.sibling);
});

test('my stats slice: snapshots the clock once and reducers reuse its ranges', () => {
  let calls = 0;
  const slice = createRouteSlice({}, context(), {
    now: () => {
      calls += 1;
      return new Date(FIXED_NOW);
    },
  });
  const ranges = slice.initialState.routes.myStats.ranges;

  const selected = slice.reducer(slice.initialState, {
    type: 'my-stats/range-selected',
    range: '12-months',
  });
  const ignored = slice.reducer(selected, { type: 'ignored' });

  assert.equal(calls, 1);
  assert.equal(selected.routes.myStats.ranges, ranges);
  assert.equal(ignored.routes.myStats.ranges, ranges);
});

test('my stats route render owns the chart tooltip lifecycle', () => {
  const routeContext = context();
  const slice = createRouteSlice({}, routeContext, {
    loadReportFeed: async () => null,
  });
  const container = document.createElement('main');
  const tools = /** @type {any} */ ({
    render,
    context: routeContext,
  });

  slice.render(container, slice.initialState, tools);
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 0);

  const chartState = slice.reducer(slice.initialState, {
    type: 'my-stats/chart-loaded',
    chart: {
      data: {
        groups: [
          {
            key: 'week-one',
            label: 'Week one',
            marks: [{ key: 'settled', label: 'Settled', value: 4 }],
          },
        ],
      },
      config: { width: 240, height: 160, ariaLabel: 'Review counts' },
    },
  });

  slice.render(container, chartState, tools);
  const firstPage = /** @type {any[]} */ (
    /** @type {unknown} */ (container.childNodes)
  ).find((/** @type {any} */ node) => node.tagName === 'MAIN');
  const firstChart = firstPage?.childNodes.find(
    (/** @type {any} */ node) => node.tagName === 'svg'
  );
  assert.ok(firstChart);
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 1);
  slice.render(container, chartState, tools);
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 1);

  container.replaceChildren();
  slice.render(container, chartState, tools);
  const secondPage = /** @type {any[]} */ (
    /** @type {unknown} */ (container.childNodes)
  ).find((/** @type {any} */ node) => node.tagName === 'MAIN');
  const secondChart = secondPage?.childNodes.find(
    (/** @type {any} */ node) => node.tagName === 'svg'
  );
  assert.ok(secondChart);
  assert.notEqual(secondChart, firstChart);
  assert.equal(
    /** @type {any} */ (firstChart)._listeners.pointerover.length,
    0
  );
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 1);

  const dispose = slice.start({
    context: routeContext,
    signal: new AbortController().signal,
    isActive: () => true,
    dispatch() {},
  });
  dispose();
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 0);
});

/** @type {import('../src/services/report-feed-loader.js').ReportFeedEnvelope} */
const envelope = {
  schema_version: 1,
  reviewer_account: 'reviewer-1',
  generated_at: '2026-08-09T04:15:00+00:00',
  complete_through: '2026-08-08',
  rows: [],
};

/** @param {Partial<any>} [overrides] */
function startTools(overrides = {}) {
  return {
    context: context(),
    signal: new AbortController().signal,
    isActive: () => true,
    dispatch: () => {},
    ...overrides,
  };
}

test('my stats slice: loads the signed-in account with the mount signal', async () => {
  /** @type {string | undefined} */
  let account;
  /** @type {AbortSignal | undefined} */
  let signal;
  const sliceContext = context();
  const toolsContext = {
    ...context(),
    chrome: makeChrome({ currentUser: { id: 'someone-else' } }),
  };
  const slice = createRouteSlice({}, sliceContext, {
    now: dependencies().now,
    loadReportFeed: async (loadedAccount, options) => {
      account = loadedAccount;
      signal = options?.signal;
      return null;
    },
  });

  const tools = startTools({ context: toolsContext });
  slice.start(tools);
  await Promise.resolve();

  assert.equal(account, tools.context.chrome.currentUser.id);
  assert.equal(signal, tools.signal);
});

test('my stats slice: dispatches a loaded Report Feed envelope', async () => {
  /** @type {unknown[]} */
  const dispatched = [];
  const slice = createRouteSlice({}, context(), {
    now: dependencies().now,
    loadReportFeed: async () => envelope,
  });

  slice.start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await Promise.resolve();

  assert.deepEqual(dispatched, [
    { type: 'report-feed/loaded', reportFeed: envelope },
  ]);
  assert.equal(
    slice.reducer(slice.initialState, /** @type {any} */ (dispatched[0])).routes
      .myStats.reportFeed,
    envelope
  );
});

test('my stats slice: dispatches null when no Report Feed exists', async () => {
  /** @type {unknown[]} */
  const dispatched = [];
  const slice = createRouteSlice({}, context(), {
    now: dependencies().now,
    loadReportFeed: async () => null,
  });

  slice.start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await Promise.resolve();

  assert.deepEqual(dispatched, [
    { type: 'report-feed/loaded', reportFeed: null },
  ]);
  assert.equal(
    slice.reducer(slice.initialState, /** @type {any} */ (dispatched[0])).routes
      .myStats.reportFeed,
    null
  );
});

test('my stats slice: suppresses a late Report Feed result after unmount', async () => {
  /** @type {(value: typeof envelope) => void} */
  let resolve = /** @type {(value: typeof envelope) => void} */ (() => {});
  const loading = new Promise((release) => {
    resolve = release;
  });
  /** @type {unknown[]} */
  const dispatched = [];
  const slice = createRouteSlice({}, context(), {
    now: dependencies().now,
    loadReportFeed: () => loading,
  });
  const tools = startTools({
    dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    isActive: () => false,
  });

  slice.start(tools);
  resolve(envelope);
  await loading;
  await Promise.resolve();

  assert.deepEqual(dispatched, []);
});

test('my stats slice: treats an aborted Report Feed load as navigation', async () => {
  const abort = Object.assign(new Error('navigation'), { name: 'AbortError' });
  /** @type {unknown[]} */
  const dispatched = [];
  const slice = createRouteSlice({}, context(), {
    now: dependencies().now,
    loadReportFeed: async () => {
      throw abort;
    },
  });

  slice.start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await Promise.resolve();

  assert.deepEqual(dispatched, []);
});
