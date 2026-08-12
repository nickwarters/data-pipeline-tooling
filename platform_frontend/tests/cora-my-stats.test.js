// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeChrome } from './helpers/fixtures.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const { createRouteSlice, myStatsView } =
  await import('../src/pages/cora-my-stats.js');
const { buildStatsRanges } =
  await import('../src/evaluators/stats-range-model.js');
const { render } = await import('../src/core/render.js');
const { toLocalDateKey } = await import('../src/lib/local-calendar.js');

/**
 * Noon local on Monday 10 August 2026. Built from local fields, so the page's
 * browser-calendar snapshot is the same date wherever the suite runs.
 */
const FIXED_NOW = new Date(2026, 7, 10, 12);
const RANGES = buildStatsRanges(FIXED_NOW);

/** @param {Record<string, unknown>} [overrides] */
function dependencies(overrides = {}) {
  return {
    now: () => new Date(FIXED_NOW),
    loadReportFeed: async () => null,
    fetchTailCases: async () => [],
    ...overrides,
  };
}

/** @param {any} [client] @param {any} [overrides] */
function context(client = {}, overrides = {}) {
  return /** @type {any} */ ({
    client,
    chrome: makeChrome(),
    caseSources: [{ slug: 'complaints', listName: 'Cases-complaints' }],
    appEl: document.createElement('div'),
    ...overrides,
  });
}

/** @type {import('../src/services/report-feed-loader.js').ReportFeedEnvelope} */
const envelope = {
  schema_version: 1,
  reviewer_account: 'reviewer-1',
  generated_at: '2026-08-09T04:15:00+00:00',
  complete_through: '2026-08-08',
  rows: [],
};

/** @type {import('../src/services/report-feed-loader.js').ReportFeedEnvelope} */
const countedEnvelope = {
  ...envelope,
  rows: [
    { date: '2026-08-04', case_type: 'complaints', count: 4 },
    { date: '2026-08-05', case_type: 'example-case-type', count: 4 },
    { date: '2026-08-08', case_type: 'complaints', count: 2 },
  ],
};

/**
 * Route state built directly. The page has no action for "pretend a chart
 * arrived" — the chart is derived from the report and the live tail — so a view
 * test states the state it wants rather than dispatching its way there.
 *
 * @param {Partial<any>} [overrides]
 */
function viewState(overrides = {}) {
  return /** @type {any} */ ({
    chrome: makeChrome(),
    routes: {
      myStats: {
        feedStatus: 'loaded',
        reportFeed: countedEnvelope,
        ranges: RANGES,
        selectedRange: 'week',
        tail: { status: 'loaded', from: '2026-08-09', typedCounts: {} },
        ...overrides,
      },
    },
  });
}

/** @param {any} root @param {(node: any) => void} visit */
function walk(root, visit) {
  visit(root);
  for (const child of root.childNodes ?? []) walk(child, visit);
}

/**
 * SVG marks carry their class as an attribute, so they are found by walking
 * rather than through the DOM stub's HTML class selectors.
 *
 * @param {any} view
 * @returns {string[]}
 */
function markLabels(view) {
  /** @type {string[]} */
  const labels = [];
  walk(view, (node) => {
    if (
      node
        .getAttribute?.('class')
        ?.split(/\s+/)
        .includes('cora-grouped-bar-chart__bar')
    ) {
      labels.push(node.getAttribute('aria-label'));
    }
  });
  return labels;
}

/** @param {any} view @returns {Record<string, string>} */
function figureValues(view) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const figure of view.querySelectorAll('.cora-my-stats-figure')) {
    const label = figure.querySelector(
      '.cora-my-stats-figure__label'
    )?.textContent;
    values[label] = figure.querySelector(
      '.cora-my-stats-figure__value'
    )?.textContent;
  }
  return values;
}

// ── The page before, and without, a report ────────────────────────────────

test('my stats view: the first paint says the report is being fetched', () => {
  const view = myStatsView(
    viewState({ feedStatus: 'loading', reportFeed: null })
  );

  assert.equal(view.tagName, 'MAIN');
  assert.equal(view.querySelector('h1')?.textContent, 'My Stats');
  assert.equal(view.getAttribute('aria-busy'), 'true');
  assert.equal(
    view.querySelector('.cora-loading')?.textContent,
    'Loading your report…'
  );
});

test('my stats view: an unpublished report is not an empty one', () => {
  const view = myStatsView(viewState({ reportFeed: null }));

  assert.equal(
    view.querySelector('.cora-my-stats-no-report')?.textContent,
    'No report has been published for you yet.'
  );
  // Distinguishable from a published report with nothing in the range.
  assert.equal(view.querySelector('.cora-my-stats-breakdown-table'), null);
  assert.equal(markLabels(view).length, 0);
  assert.equal(view.getAttribute('aria-busy'), 'false');
});

test('my stats view: a published report with nothing in range keeps the table', () => {
  const view = myStatsView(viewState({ reportFeed: envelope }));

  assert.equal(view.querySelector('.cora-my-stats-no-report'), null);
  const table = view.querySelector('.cora-my-stats-breakdown-table');
  assert.ok(table);
  assert.equal(table.querySelector('tbody')?.childNodes.length, 8);
});

test('my stats view: a report that could not be read says so', () => {
  const view = myStatsView(viewState({ feedStatus: 'failed' }));

  const error = view.querySelector('.cora-my-stats-error');
  assert.equal(error?.getAttribute('role'), 'alert');
  assert.match(error?.textContent, /could not be loaded/);
});

test('my stats view: a selection with no matching range falls back rather than throwing', () => {
  const view = myStatsView(viewState({ selectedRange: 'decade' }));

  assert.equal(
    view.querySelector('.cora-my-stats-empty')?.textContent,
    'No data yet.'
  );
});

// ── The page with a report ────────────────────────────────────────────────

test('my stats view: the table, chart and figures are all rendered', () => {
  const view = myStatsView(viewState());

  const topRow = view.querySelector('.cora-my-stats-top-row');
  assert.ok(topRow);
  const topRowChildren = /** @type {any[]} */ (Array.from(topRow.childNodes));
  assert.equal(topRowChildren[0]?.className, 'cora-my-stats-controls-column');
  assert.equal(
    topRowChildren[0]?.querySelector('.cora-my-stats-breakdown-table'),
    null
  );
  assert.equal(topRowChildren[1]?.tagName, 'svg');
  assert.ok(view.querySelector('.cora-my-stats-headline'));
  assert.ok(view.querySelector('.cora-my-stats-breakdown-table'));
  const mainChildren = /** @type {any[]} */ (Array.from(view.childNodes));
  const headlineIndex = mainChildren.findIndex((node) =>
    node.className?.includes('cora-my-stats-headline')
  );
  const tableIndex = mainChildren.findIndex((node) =>
    node.className?.includes('cora-my-stats-breakdown')
  );
  assert.equal(tableIndex, headlineIndex + 1);
});

test('my stats view: range controls expose selection and dispatch changes', () => {
  /** @type {any[]} */
  const actions = [];
  const view = myStatsView(viewState(), (action) => actions.push(action));
  const controls = view.querySelector('.cora-my-stats-range-controls');
  const buttons = controls?.querySelectorAll('button') ?? [];

  assert.equal(controls?.getAttribute('role'), 'group');
  assert.equal(controls?.getAttribute('aria-label'), 'Stats range');
  assert.deepEqual(
    Array.from(buttons, (button) => button.textContent),
    ['Week', 'Month', '3 months', '12 months']
  );
  assert.equal(buttons[0]?.getAttribute('aria-pressed'), 'true');
  assert.equal(buttons[1]?.getAttribute('aria-pressed'), 'false');

  buttons[2]?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  assert.deepEqual(actions, [
    { type: 'my-stats/range-selected', range: '3-months' },
  ]);
});

test('my stats view: published days and live days reach the chart and the figures together', () => {
  const view = myStatsView(
    viewState({
      tail: {
        status: 'loaded',
        from: '2026-08-09',
        typedCounts: {
          '2026-08-09': { complaints: 3 },
          '2026-08-10': { complaints: 50 },
        },
      },
    })
  );

  // The week range runs Monday 3 August to yesterday, Sunday 9 August: 4 + 4
  // on the published days, 2 more on the 8th and 3 counted live on the 9th,
  // over five working days. The 50 on the 10th is today and stays out.
  assert.deepEqual(figureValues(view), {
    'Total *': '13',
    'Avg per working day': '2.6',
    'Active days': '4',
    'Busiest day': '4 Aug',
  });
  assert.deepEqual(markLabels(view).slice(-3), [
    'Aug 8: Settled, 2',
    'Aug 9: Provisional, 3, provisional',
    'Aug 10 (today): Provisional, 50, provisional',
  ]);
});

test('my stats view: hollow marks begin the day after the report ends', () => {
  const labels = markLabels(myStatsView(viewState()));

  assert.equal(
    labels.filter((label) => label.includes('Settled')).length,
    // 3 August through 8 August: the report is complete through the 8th.
    6
  );
  assert.equal(
    labels.filter((label) => label.includes('Provisional')).length,
    2
  );
});

test('my stats view: an unreadable boundary settles nothing rather than claiming days', () => {
  const view = myStatsView(
    viewState({
      reportFeed: { ...countedEnvelope, complete_through: 'unknown' },
    })
  );

  assert.equal(
    markLabels(view).filter((label) => label.includes('Settled')).length,
    0
  );
});

test('my stats view: a failed live read is noted without hiding the published half', () => {
  const view = myStatsView(
    viewState({ tail: { status: 'failed', from: null, typedCounts: {} } })
  );

  assert.match(
    view.querySelector('.cora-my-stats-tail-note')?.textContent ?? '',
    /could not be counted just now/
  );
  assert.ok(view.querySelector('.cora-my-stats-headline'));
  assert.ok(markLabels(view).some((label) => label.includes('Settled')));
  assert.equal(figureValues(view)['Total *'], '10');
});

test('my stats view: a report older than the clamp says which days are missing', () => {
  const view = myStatsView(
    viewState({
      reportFeed: { ...countedEnvelope, complete_through: '2026-06-30' },
      tail: { status: 'loaded', from: '2026-08-01', typedCounts: {} },
    })
  );

  assert.match(
    view.querySelector('.cora-my-stats-tail-note')?.textContent ?? '',
    /Only the last 10 days of unpublished work are counted here/
  );
});

test('my stats view: a live read that reached the report leaves no note', () => {
  const view = myStatsView(viewState());

  assert.equal(view.querySelector('.cora-my-stats-tail-note'), null);
});

test('my stats view: the page is busy while the live read is in flight', () => {
  const view = myStatsView(
    viewState({ tail: { status: 'loading', from: null, typedCounts: {} } })
  );

  assert.equal(view.getAttribute('aria-busy'), 'true');
});

// ── The slice ─────────────────────────────────────────────────────────────

test('my stats slice: keeps shared chrome and starts with nothing read', () => {
  const chrome = makeChrome();
  const slice = createRouteSlice({}, { ...context(), chrome }, dependencies());

  assert.equal(slice.initialState.chrome, chrome);
  assert.deepEqual(slice.initialState.routes.myStats, {
    feedStatus: 'loading',
    reportFeed: null,
    ranges: RANGES,
    selectedRange: 'week',
    tail: { status: 'idle', from: null, typedCounts: {} },
  });
  assert.equal(
    slice.reducer(slice.initialState, { type: 'ignored' }),
    slice.initialState
  );
});

test('my stats slice: the report and its failure are separate answers', () => {
  const slice = createRouteSlice({}, context(), dependencies());

  const loaded = slice.reducer(slice.initialState, {
    type: 'report-feed/loaded',
    reportFeed: envelope,
  });
  assert.equal(loaded.routes.myStats.feedStatus, 'loaded');
  assert.equal(loaded.routes.myStats.reportFeed, envelope);

  const empty = slice.reducer(slice.initialState, {
    type: 'report-feed/loaded',
    reportFeed: null,
  });
  assert.equal(empty.routes.myStats.feedStatus, 'loaded');
  assert.equal(empty.routes.myStats.reportFeed, null);

  const failed = slice.reducer(slice.initialState, {
    type: 'report-feed/failed',
  });
  assert.equal(failed.routes.myStats.feedStatus, 'failed');
  assert.equal(failed.routes.myStats.reportFeed, null);
});

test('my stats slice: the live read moves through its three states', () => {
  const slice = createRouteSlice({}, context(), dependencies());

  const requested = slice.reducer(slice.initialState, {
    type: 'my-stats/tail-requested',
  });
  assert.deepEqual(requested.routes.myStats.tail, {
    status: 'loading',
    from: null,
    typedCounts: {},
  });

  const loaded = slice.reducer(requested, {
    type: 'my-stats/tail-loaded',
    from: '2026-08-09',
    typedCounts: { '2026-08-09': { complaints: 2 } },
  });
  assert.deepEqual(loaded.routes.myStats.tail, {
    status: 'loaded',
    from: '2026-08-09',
    typedCounts: { '2026-08-09': { complaints: 2 } },
  });

  const failed = slice.reducer(requested, { type: 'my-stats/tail-failed' });
  assert.deepEqual(failed.routes.myStats.tail, {
    status: 'failed',
    from: null,
    typedCounts: {},
  });
});

test('my stats slice: accepts every range in the snapshot and ignores anything else', () => {
  const slice = createRouteSlice({}, context(), dependencies());

  for (const range of ['week', 'month', '3-months', '12-months']) {
    const next = slice.reducer(slice.initialState, {
      type: 'my-stats/range-selected',
      range,
    });
    assert.equal(next.routes.myStats.selectedRange, range);
  }
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
  const state = /** @type {any} */ ({
    ...slice.initialState,
    routes: {
      ...slice.initialState.routes,
      myStats: {
        ...slice.initialState.routes.myStats,
        reportFeed: envelope,
        futureField: 'preserved',
      },
      sibling: { value: 1 },
    },
  });

  const next = /** @type {any} */ (
    slice.reducer(state, { type: 'my-stats/range-selected', range: 'month' })
  );

  assert.equal(next.chrome, chrome);
  assert.equal(next.routes.myStats.reportFeed, envelope);
  assert.equal(next.routes.myStats.ranges, state.routes.myStats.ranges);
  assert.equal(next.routes.myStats.futureField, 'preserved');
  assert.equal(next.routes.sibling, state.routes.sibling);
});

test('my stats slice: with no clock injected it reads the browser calendar', () => {
  const slice = createRouteSlice({}, context(), {
    loadReportFeed: async () => null,
    fetchTailCases: async () => [],
  });

  assert.equal(
    slice.initialState.routes.myStats.ranges[0].today,
    toLocalDateKey(new Date())
  );
});

test('my stats slice: snapshots the clock once and reducers reuse its ranges', () => {
  let calls = 0;
  const slice = createRouteSlice(
    {},
    context(),
    dependencies({
      now: () => {
        calls += 1;
        return new Date(FIXED_NOW);
      },
    })
  );
  const ranges = slice.initialState.routes.myStats.ranges;

  const selected = slice.reducer(slice.initialState, {
    type: 'my-stats/range-selected',
    range: '12-months',
  });

  assert.equal(calls, 1);
  assert.equal(selected.routes.myStats.ranges, ranges);
});

// ── Loading ───────────────────────────────────────────────────────────────

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

/** Run every queued microtask so both stages of the load settle. */
async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

test('my stats slice: loads the signed-in account with the mount signal', async () => {
  /** @type {string | undefined} */
  let account;
  /** @type {AbortSignal | undefined} */
  let signal;
  const slice = createRouteSlice(
    {},
    context(),
    dependencies({
      loadReportFeed: async (
        /** @type {string} */ loadedAccount,
        /** @type {any} */ options
      ) => {
        account = loadedAccount;
        signal = options?.signal;
        return null;
      },
    })
  );

  const tools = startTools();
  slice.start(tools);
  await settle();

  assert.equal(account, tools.context.chrome.currentUser.id);
  assert.equal(signal, tools.signal);
});

test('my stats slice: with no published report, no Case list is read at all', async () => {
  /** @type {unknown[]} */
  const dispatched = [];
  let tailReads = 0;
  const slice = createRouteSlice(
    {},
    context(),
    dependencies({
      loadReportFeed: async () => null,
      fetchTailCases: async () => {
        tailReads += 1;
        return [];
      },
    })
  );

  slice.start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await settle();

  assert.equal(tailReads, 0);
  assert.deepEqual(dispatched, [
    { type: 'report-feed/loaded', reportFeed: null },
  ]);
});

test('my stats slice: a published report is topped up with its uncovered days', async () => {
  /** @type {any[]} */
  const dispatched = [];
  /** @type {any} */
  let window;
  const slice = createRouteSlice(
    {},
    context(),
    dependencies({
      loadReportFeed: async () => envelope,
      fetchTailCases: async (
        /** @type {any} */ _client,
        /** @type {any} */ _reviewer,
        /** @type {any} */ _sources,
        /** @type {any} */ requested
      ) => {
        window = requested;
        return [
          {
            id: '1',
            caseType: 'complaints',
            reportableAt: new Date(2026, 7, 9, 10).toISOString(),
          },
          {
            id: '2',
            caseType: 'complaints',
            reportableAt: new Date(2026, 7, 9, 16).toISOString(),
          },
          {
            id: '3',
            caseType: 'example-case-type',
            reportableAt: new Date(2026, 7, 10, 9).toISOString(),
          },
        ];
      },
    })
  );

  slice.start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await settle();

  assert.equal(window.from, '2026-08-09');
  assert.deepEqual(dispatched, [
    { type: 'report-feed/loaded', reportFeed: envelope },
    { type: 'my-stats/tail-requested' },
    {
      type: 'my-stats/tail-loaded',
      from: '2026-08-09',
      typedCounts: {
        '2026-08-09': { complaints: 2 },
        '2026-08-10': { 'example-case-type': 1 },
      },
    },
  ]);

  const withFeed = slice.reducer(slice.initialState, {
    type: 'report-feed/loaded',
    reportFeed: envelope,
  });
  const withTail = slice.reducer(withFeed, dispatched[2]);
  assert.deepEqual(withTail.routes.myStats.tail.typedCounts, {
    '2026-08-09': { complaints: 2 },
    '2026-08-10': { 'example-case-type': 1 },
  });
  const rendered = myStatsView(withTail);
  assert.ok(
    markLabels(rendered).some((label) =>
      label.includes('Aug 9: Provisional, 2')
    )
  );
  const table = rendered.querySelector('.cora-my-stats-breakdown-table');
  const rows = Array.from(table?.querySelector('tbody')?.childNodes ?? []);
  const liveRow = rows[6];
  assert.equal(liveRow?.querySelectorAll('td')[0]?.textContent, '2');
});

test('my stats slice: a report already covering today asks for no rows', async () => {
  /** @type {any[]} */
  const dispatched = [];
  let tailReads = 0;
  const slice = createRouteSlice(
    {},
    context(),
    dependencies({
      loadReportFeed: async () => ({
        ...envelope,
        complete_through: '2026-08-10',
      }),
      fetchTailCases: async () => {
        tailReads += 1;
        return [];
      },
    })
  );

  slice.start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await settle();

  assert.equal(tailReads, 0);
  assert.deepEqual(dispatched[1], {
    type: 'my-stats/tail-loaded',
    from: null,
    typedCounts: {},
  });
});

test('my stats slice: the mount lifetime is bound once, at the client', async () => {
  /** @type {any[]} */
  const reads = [];
  const client = {
    listCases: async (/** @type {any} */ filter, /** @type {any} */ opts) => {
      reads.push({ filter, opts });
      return [];
    },
  };
  const tools = startTools({ context: context(client) });
  const slice = createRouteSlice(
    {},
    context(client),
    // The real fetcher, so the whole chain is under test: the page binds, and
    // nothing below it touches the signal.
    dependencies({
      loadReportFeed: async () => envelope,
      fetchTailCases: undefined,
    })
  );

  slice.start(tools);
  await settle();

  assert.equal(reads.length, 1);
  assert.equal(reads[0].opts.signal, tools.signal);
  assert.equal(reads[0].opts.listName, 'Cases-complaints');
  assert.equal(
    reads[0].filter.assignedReviewer,
    tools.context.chrome.currentUser.id
  );
});

test('my stats slice: a mount with no client fails the live read, not the route', async () => {
  /** @type {any[]} */
  const dispatched = [];
  const slice = createRouteSlice(
    {},
    context(null),
    dependencies({
      loadReportFeed: async () => envelope,
      fetchTailCases: undefined,
    })
  );

  slice.start(
    startTools({
      context: context(null),
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await settle();

  assert.deepEqual(dispatched[2], { type: 'my-stats/tail-failed' });
});

test('my stats slice: a failed live read leaves the published report standing', async () => {
  /** @type {any[]} */
  const dispatched = [];
  const slice = createRouteSlice(
    {},
    context(),
    dependencies({
      loadReportFeed: async () => envelope,
      fetchTailCases: async () => {
        throw new Error('nope');
      },
    })
  );

  slice.start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await settle();

  assert.deepEqual(dispatched[0], {
    type: 'report-feed/loaded',
    reportFeed: envelope,
  });
  assert.deepEqual(dispatched[2], { type: 'my-stats/tail-failed' });
});

test('my stats slice: an aborted live read is navigation, not a failure', async () => {
  /** @type {any[]} */
  const dispatched = [];
  const slice = createRouteSlice(
    {},
    context(),
    dependencies({
      loadReportFeed: async () => envelope,
      fetchTailCases: async () => {
        throw Object.assign(new Error('navigation'), { name: 'AbortError' });
      },
    })
  );

  slice.start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await settle();

  assert.deepEqual(dispatched, [
    { type: 'report-feed/loaded', reportFeed: envelope },
    { type: 'my-stats/tail-requested' },
  ]);
});

test('my stats slice: a live read that returns after unmount is discarded', async () => {
  /** @type {any[]} */
  const dispatched = [];
  let active = true;
  const slice = createRouteSlice(
    {},
    context(),
    dependencies({
      loadReportFeed: async () => envelope,
      fetchTailCases: async () => {
        active = false;
        return [{ id: '1', reportableAt: '2026-08-09T10:00:00.000Z' }];
      },
    })
  );

  slice.start(
    startTools({
      isActive: () => active,
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await settle();

  assert.deepEqual(
    dispatched.map((action) => action.type),
    ['report-feed/loaded', 'my-stats/tail-requested']
  );
});

test('my stats slice: a report that returns after unmount is discarded', async () => {
  /** @type {unknown[]} */
  const dispatched = [];
  const slice = createRouteSlice(
    {},
    context(),
    dependencies({ loadReportFeed: async () => envelope })
  );

  slice.start(
    startTools({
      isActive: () => false,
      dispatch: (/** @type {unknown} */ action) => dispatched.push(action),
    })
  );
  await settle();

  assert.deepEqual(dispatched, []);
});

test('my stats slice: a failed report read is reported, an aborted one is not', async () => {
  /** @type {unknown[]} */
  const failed = [];
  createRouteSlice(
    {},
    context(),
    dependencies({
      loadReportFeed: async () => {
        throw new Error('HTTP 500');
      },
    })
  ).start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => failed.push(action),
    })
  );

  /** @type {unknown[]} */
  const aborted = [];
  createRouteSlice(
    {},
    context(),
    dependencies({
      loadReportFeed: async () => {
        throw Object.assign(new Error('navigation'), { name: 'AbortError' });
      },
    })
  ).start(
    startTools({
      dispatch: (/** @type {unknown} */ action) => aborted.push(action),
    })
  );
  await settle();

  assert.deepEqual(failed, [{ type: 'report-feed/failed' }]);
  assert.deepEqual(aborted, []);
});

// ── The tooltip the route owns around the chart ───────────────────────────

test('my stats route render owns the chart tooltip lifecycle', () => {
  const routeContext = context();
  const slice = createRouteSlice({}, routeContext, dependencies());
  const container = document.createElement('main');
  const tools = /** @type {any} */ ({ render, context: routeContext });

  slice.render(container, slice.initialState, tools);
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 0);

  const withReport = slice.reducer(slice.initialState, {
    type: 'report-feed/loaded',
    reportFeed: countedEnvelope,
  });

  slice.render(container, withReport, tools);
  const firstChart = container.querySelector('svg.cora-grouped-bar-chart');
  assert.ok(firstChart);
  const staleMark = firstChart.querySelector('[data-cora-chart-mark="true"]');
  assert.ok(staleMark);
  assert.ok(container.querySelector('.cora-my-stats-top-row'));
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 1);

  slice.render(container, withReport, tools);
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 1);

  container.replaceChildren();
  slice.render(container, withReport, tools);
  const secondChart = container.querySelector('svg.cora-grouped-bar-chart');
  assert.ok(secondChart);
  assert.notEqual(secondChart, firstChart);
  fireEvent(staleMark, 'pointerover');
  assert.equal(staleMark.getAttribute('aria-describedby'), null);
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 1);

  const dispose = slice.start(
    /** @type {any} */ (startTools({ context: routeContext }))
  );
  dispose();
  assert.equal(routeContext.appEl.querySelectorAll('div').length, 0);
});
