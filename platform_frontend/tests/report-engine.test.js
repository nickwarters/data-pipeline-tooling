// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeChrome } from './helpers/fixtures.js';
import {
  fireEvent,
  getByRole,
  getByText,
  queryAllByText,
  queryByRole,
  textContent,
} from './helpers/semantic-dom.js';

installDom();

const { createReportRouteSlice } =
  await import('../src/reports/report-engine.js');
const { render } = await import('../src/core/render.js');
const { svg } = await import('../src/lib/html.js');

/** @typedef {import('../src/reports/contract.js').ReportPlugin} ReportPlugin */
/** @typedef {import('../src/services/report-feed-loader.js').ReportFileResult} ReportFileResult */

const NOW = new Date(2026, 9, 7, 12);

/** @param {Record<string, unknown>} [datasets] @param {Record<string, unknown>} [extra] */
function envelope(datasets = {}, extra = {}) {
  return {
    schema_version: 1,
    generated_at: '2026-10-07T04:15:00+00:00',
    complete_through: '2026-10-06',
    datasets,
    ...extra,
  };
}

/** @param {Record<string, unknown>} [datasets] @returns {ReportFileResult} */
function loaded(datasets = {}) {
  return { status: 'loaded', envelope: envelope(datasets) };
}

/** @param {Partial<ReportPlugin>} [overrides] */
function makePlugin(overrides = {}) {
  /** @type {any[]} */
  const calls = [];
  /** @type {ReportPlugin} */
  const plugin = {
    id: 'example',
    title: 'Example report',
    description: 'An example.',
    layout: 'stacked',
    access: ['maintainer', { role: 'caseTypeOwner', of: 'scope' }],
    scope: { kind: 'case-type' },
    feeds: {
      report: {
        path: (scope) => `case-types/${scope.key}/example.txt`,
        schemaVersion: 1,
      },
    },
    filters: {
      range: {
        label: 'Range',
        options: [
          { key: 'short', label: 'Short' },
          { key: 'long', label: 'Long' },
        ],
        initial: 'short',
      },
    },
    view: (input) => {
      calls.push(input);
      return {
        kpis: [{ key: 'open', label: 'Open', value: '214' }],
        sections: [
          {
            id: 'over-time',
            title: 'Over time',
            filters: ['range'],
            panels: [
              {
                id: 'chart',
                title: `Chart for ${input.filters.range}`,
                render: (width) =>
                  svg('svg', {
                    className: 'cora-chart',
                    'data-width': String(width),
                  }),
                table: {
                  columns: [{ key: 'n', label: 'N', value: 'n' }],
                  rows: [{ n: 2 }, { n: 1 }],
                  rowKey: (row) => String(row.n),
                },
              },
            ],
          },
        ],
      };
    },
    ...overrides,
  };
  return { plugin, calls };
}

const OWNER = { ownedCaseTypes: ['complaints'], isReviewer: false };

/**
 * @param {ReportPlugin} plugin
 * @param {{
 *   params?: Record<string, string>,
 *   permissions?: Record<string, unknown>,
 *   load?: (path: string, options: any) => Promise<ReportFileResult>,
 *   now?: Date,
 * }} [options]
 */
function mount(plugin, options = {}) {
  /** @type {{ path: string, options: any }[]} */
  const requests = [];
  const slice = createReportRouteSlice(
    plugin,
    options.params ?? {},
    /** @type {any} */ ({
      chrome: makeChrome({ permissions: options.permissions ?? OWNER }),
      appEl: document.createElement('div'),
    }),
    {
      loadReportFile: async (path, loadOptions) => {
        requests.push({ path, options: loadOptions });
        return (options.load ?? (async () => loaded()))(path, loadOptions);
      },
      now: () => new Date(options.now ?? NOW),
    }
  );
  const container = /** @type {any} */ (document.createElement('div'));
  const appEl = /** @type {any} */ (document.createElement('div'));
  const controller = new AbortController();
  let state = slice.initialState;
  const tools = {
    render,
    context: /** @type {any} */ ({ appEl }),
    isActive: () => !controller.signal.aborted,
    signal: controller.signal,
    dispatch: (/** @type {any} */ action) => {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
  };
  slice.render(container, state, tools);
  const stop = slice.start(tools);
  return {
    slice,
    container,
    appEl,
    requests,
    tools,
    get state() {
      return state;
    },
    unmount() {
      controller.abort();
      stop();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('without a scope in the URL, the viewer’s first scope opens and its files are requested', async () => {
  const { plugin } = makePlugin();
  const page = mount(plugin);
  assert.equal(page.state.routes.report.scopeKey, 'complaints');
  assert.equal(
    page.container.querySelector('main').getAttribute('aria-busy'),
    'true'
  );
  assert.ok(getByText(page.container, 'Loading report…'));
  await settle();
  assert.deepEqual(
    page.requests.map(({ path, options }) => [path, options.schemaVersion]),
    [['case-types/complaints/example.txt', 1]]
  );
  assert.ok(page.requests[0].options.signal instanceof AbortSignal);
  assert.equal(
    page.container.querySelector('main').getAttribute('aria-busy'),
    'false'
  );
});

test('a loaded report draws its view inside the frame, named for its scope', async () => {
  const { plugin, calls } = makePlugin();
  const page = mount(plugin, { params: { scope: 'complaints' } });
  await settle();

  assert.ok(getByRole(page.container, 'heading', { name: 'Complaints' }));
  assert.ok(getByText(page.container, 'Example report'));
  assert.ok(getByText(page.container, 'Chart for short'));
  const viewer = calls.at(-1).viewer;
  assert.equal(viewer.scope.key, 'complaints');
  assert.equal(viewer.today, '2026-10-07');
  assert.equal(viewer.user.displayName, 'Reviewer One');
  assert.deepEqual(viewer.capabilities.ownedCaseTypes, ['complaints']);
  assert.deepEqual(calls.at(-1).filters, { range: 'short' });
  assert.equal(calls.at(-1).feeds.report.complete_through, '2026-10-06');
});

test('a scope the viewer may not open is refused without reading any file', async () => {
  const { plugin, calls } = makePlugin({
    access: [{ role: 'caseTypeOwner', of: 'scope' }],
  });
  const page = mount(plugin, {
    params: { scope: 'complaints' },
    permissions: { ownedCaseTypes: [] },
  });
  await settle();
  assert.equal(page.state.routes.report.problem, 'denied');
  assert.equal(page.requests.length, 0);
  assert.equal(calls.length, 0);
  assert.ok(getByText(page.container, 'You don’t have access to this report.'));
  assert.equal(getByText(page.container, 'Back to Reports').tagName, 'A');
});

test('a viewer the report admits nowhere is refused even with no scope asked for', async () => {
  const { plugin } = makePlugin({ access: ['controls'] });
  const page = mount(plugin, { permissions: { isControls: false } });
  assert.equal(page.state.routes.report.problem, 'denied');
  assert.equal(page.requests.length, 0);
});

test('a scope that does not exist is a different message from one the viewer may not open', async () => {
  const { plugin } = makePlugin();
  const page = mount(plugin, { params: { scope: 'no-such-thing' } });
  assert.equal(page.state.routes.report.problem, 'unknown-scope');
  assert.ok(
    getByText(page.container, 'There is no example report for that scope.')
  );
});

test('a report nobody has published yet says so, rather than failing', async () => {
  const { plugin } = makePlugin();
  const page = mount(plugin, { load: async () => ({ status: 'missing' }) });
  await settle();
  assert.ok(
    getByText(
      page.container,
      'No Example report has been published for Complaints yet.'
    )
  );
});

test('a file in a folder the viewer cannot read is reported as no access', async () => {
  const { plugin } = makePlugin();
  const page = mount(plugin, { load: async () => ({ status: 'forbidden' }) });
  await settle();
  assert.ok(getByText(page.container, 'You don’t have access to this report.'));
});

test('a file that cannot be read for any other reason is an alerted failure', async () => {
  const { plugin } = makePlugin();
  const page = mount(plugin, {
    load: async () => {
      throw new Error('HTTP 500');
    },
  });
  await settle();
  assert.match(textContent(page.container), /could not be loaded/);
  assert.ok(page.container.querySelector('.cora-report-message__text--alert'));
});

test('a feed path that throws fails that feed rather than the mount', async () => {
  const { plugin } = makePlugin({
    feeds: {
      report: {
        path: () => {
          throw new Error('bad path');
        },
        schemaVersion: 1,
      },
    },
  });
  const page = mount(plugin);
  await settle();
  assert.equal(page.state.routes.report.feeds.report.status, 'failed');
});

test('an aborted read, or one that settles after navigation, changes nothing', async () => {
  const { plugin } = makePlugin();
  const abortError = Object.assign(new Error('aborted'), {
    name: 'AbortError',
  });
  const aborted = mount(plugin, {
    load: async () => {
      throw abortError;
    },
  });
  await settle();
  assert.equal(aborted.state.routes.report.feeds.report.status, 'loading');

  /** @type {(value: ReportFileResult) => void} */
  let resolveLate = () => {};
  /** @type {(error: Error) => void} */
  let rejectLate = () => {};
  const late = mount(plugin, {
    load: () => new Promise((resolve) => (resolveLate = resolve)),
  });
  late.unmount();
  resolveLate(loaded());
  await settle();
  assert.equal(late.state.routes.report.feeds.report.status, 'loading');

  const lateFailure = mount(plugin, {
    load: () => new Promise((_, reject) => (rejectLate = reject)),
  });
  lateFailure.unmount();
  rejectLate(new Error('HTTP 500'));
  await settle();
  assert.equal(lateFailure.state.routes.report.feeds.report.status, 'loading');
});

test('the page is ready only when every file a report reads has arrived', async () => {
  /** @type {Record<string, (value: ReportFileResult) => void>} */
  const resolvers = {};
  const { plugin, calls } = makePlugin({
    feeds: {
      report: { path: () => 'a/primary.txt', schemaVersion: 1 },
      extra: { path: () => 'a/extra.txt', schemaVersion: 1 },
    },
  });
  const page = mount(plugin, {
    load: (path) => new Promise((resolve) => (resolvers[path] = resolve)),
  });
  await settle();
  resolvers['a/primary.txt'](loaded());
  await settle();
  assert.equal(calls.length, 0);
  resolvers['a/extra.txt']({
    status: 'loaded',
    envelope: envelope({}, { complete_through: '2026-01-01' }),
  });
  await settle();
  assert.deepEqual(Object.keys(calls.at(-1).feeds), ['report', 'extra']);
  assert.match(textContent(page.container), /Complete through Tue 6 Oct/);
});

test('a file that has fallen behind is still shown, under a banner saying so', async () => {
  const { plugin } = makePlugin();
  const stale = mount(plugin, { now: new Date(2026, 9, 14, 12) });
  await settle();
  const banner = getByRole(stale.container, 'status');
  assert.match(textContent(banner), /only run to Tue 6 Oct/);
  assert.ok(getByText(stale.container, 'Chart for short'));

  const recent = mount(plugin, { now: new Date(2026, 9, 9, 12) });
  await settle();
  assert.equal(queryByRole(recent.container, 'status'), null);
});

test('a report can allow its file to run further behind before the banner shows', async () => {
  const { plugin } = makePlugin({ staleAfterWorkingDays: 10 });
  const page = mount(plugin, { now: new Date(2026, 9, 14, 12) });
  await settle();
  assert.equal(queryByRole(page.container, 'status'), null);
});

test('a file that does not say what it covers gets no banner and says so in the header', async () => {
  const { plugin } = makePlugin();
  const page = mount(plugin, {
    load: async () => ({
      status: 'loaded',
      envelope: { schema_version: 1, datasets: {} },
    }),
  });
  await settle();
  assert.equal(queryByRole(page.container, 'status'), null);
  assert.ok(getByText(page.container, 'Completeness not stated'));
});

test('choosing a filter option redraws the report for it, and an option the report does not offer is ignored', async () => {
  const { plugin, calls } = makePlugin();
  const page = mount(plugin);
  await settle();

  fireEvent(getByRole(page.container, 'button', { name: 'Long' }), 'click');
  assert.deepEqual(calls.at(-1).filters, { range: 'long' });
  assert.ok(getByText(page.container, 'Chart for long'));

  const before = page.state;
  page.tools.dispatch({
    type: 'report/filter-selected',
    name: 'range',
    value: 'forever',
  });
  page.tools.dispatch({
    type: 'report/filter-selected',
    name: 'colour',
    value: 'blue',
  });
  assert.deepEqual(
    page.state.routes.report.filters,
    before.routes.report.filters
  );
});

test('a report with no filters starts with none', async () => {
  const { plugin } = makePlugin({
    filters: undefined,
    view: () => ({ kpis: [{ key: 'open', label: 'Open', value: '1' }] }),
  });
  const page = mount(plugin);
  await settle();
  assert.deepEqual(page.state.routes.report.filters, {});
  assert.ok(getByText(page.container, 'Open'));
});

test('a panel switches to its table and back, and its columns sort both ways', async () => {
  const { plugin } = makePlugin();
  const page = mount(plugin);
  await settle();

  fireEvent(getByRole(page.container, 'button', { name: 'Table' }), 'click');
  assert.deepEqual(page.state.routes.report.tables, ['chart']);
  assert.ok(page.container.querySelector('table'));

  fireEvent(
    getByRole(page.container, 'columnheader', { name: 'N' }).querySelector(
      'button'
    ) ?? getByRole(page.container, 'columnheader', { name: 'N' }),
    'click'
  );
  assert.deepEqual(page.state.routes.report.sorts, {
    chart: { key: 'n', dir: 'asc' },
  });
  page.tools.dispatch({
    type: 'report/table-sort-requested',
    panel: 'chart',
    key: 'n',
  });
  assert.deepEqual(page.state.routes.report.sorts, {
    chart: { key: 'n', dir: 'desc' },
  });

  fireEvent(getByRole(page.container, 'button', { name: 'Chart' }), 'click');
  assert.deepEqual(page.state.routes.report.tables, []);
});

test('charts are redrawn for a new page width, but not for a change of a few pixels', async () => {
  const { plugin } = makePlugin();
  const page = mount(plugin);
  await settle();
  page.tools.dispatch({ type: 'report/resized', width: 1104 });
  assert.equal(page.state.routes.report.width, 1100);
  page.tools.dispatch({ type: 'report/resized', width: 700 });
  assert.equal(page.state.routes.report.width, 700);
  const chart = page.container.querySelector('svg.cora-chart');
  assert.ok(Number(chart.getAttribute('data-width')) < 700);
});

test('every chart on the page gets a tooltip, and loses it when the chart goes', async () => {
  const { plugin } = makePlugin();
  const page = mount(plugin);
  await settle();
  const tooltips = () =>
    page.appEl.querySelectorAll('.cora-chart-tooltip').length;
  assert.equal(tooltips(), 1);

  page.tools.dispatch({ type: 'report/resized', width: 1100 });
  assert.equal(tooltips(), 1);

  page.tools.dispatch({ type: 'report/table-toggled', panel: 'chart' });
  assert.equal(tooltips(), 0);

  page.tools.dispatch({ type: 'report/table-toggled', panel: 'chart' });
  assert.equal(tooltips(), 1);
  page.unmount();
  assert.equal(tooltips(), 0);
});

test('the page measures its own width and redraws for it on the next frame', async () => {
  const globals = /** @type {Record<string, any>} */ (globalThis);
  /** @type {(() => void)[]} */
  const observers = [];
  let disconnected = 0;
  /** @type {(() => void)[]} */
  const frames = [];
  const originalObserver = globals.ResizeObserver;
  const originalFrame = globals.requestAnimationFrame;
  globals.ResizeObserver = class {
    /** @param {() => void} callback */
    constructor(callback) {
      observers.push(callback);
    }
    observe() {}
    disconnect() {
      disconnected += 1;
    }
  };
  globals.requestAnimationFrame = (/** @type {() => void} */ frame) =>
    frames.push(frame);
  try {
    const { plugin } = makePlugin();
    const page = mount(plugin);
    await settle();
    assert.equal(observers.length, 1, 'one observer for the whole page');

    page.container.clientWidth = 812.6;
    observers[0]();
    assert.equal(
      page.state.routes.report.width,
      1100,
      'nothing happens inside the callback'
    );
    frames.shift()?.();
    assert.equal(page.state.routes.report.width, 812);

    page.container.clientWidth = 0;
    observers[0]();
    frames.shift()?.();
    assert.equal(
      page.state.routes.report.width,
      812,
      'a hidden page is not a zero-width page'
    );

    page.container.clientWidth = 500;
    observers[0]();
    page.unmount();
    frames.shift()?.();
    assert.equal(
      page.state.routes.report.width,
      812,
      'no redraw after navigation'
    );
    assert.equal(disconnected, 1);
  } finally {
    globals.ResizeObserver = originalObserver;
    globals.requestAnimationFrame = originalFrame;
  }
});

test('a rail report draws its headline figures in the rail on a wide page', async () => {
  const { plugin } = makePlugin({ layout: 'rail' });
  const page = mount(plugin);
  await settle();
  page.tools.dispatch({ type: 'report/resized', width: 1200 });
  assert.ok(page.container.querySelector('aside'));
  assert.equal(queryAllByText(page.container, 'Right now').length, 1);
});

test('an action the engine does not know leaves the page as it was', () => {
  const { plugin } = makePlugin();
  const page = mount(plugin);
  const before = page.state;
  assert.equal(
    page.slice.reducer(before, /** @type {any} */ ({ type: 'other/thing' })),
    before
  );
});

test('the back link leads to the reports index', () => {
  const { plugin } = makePlugin();
  const page = mount(plugin, { params: { scope: 'no-such-thing' } });
  assert.equal(
    getByText(page.container, 'Back to Reports').getAttribute('href'),
    '#/reports'
  );
});
