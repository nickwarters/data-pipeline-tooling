// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeChrome } from './helpers/fixtures.js';

installDom();

const { createRouteSlice, myStatsView } =
  await import('../src/pages/cora-my-stats.js');

/** @param {any} [client] */
function context(client = {}) {
  return /** @type {any} */ ({
    client,
    chrome: makeChrome(),
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

test('my stats slice: keeps shared chrome and starts with no Report Feed', () => {
  const chrome = makeChrome();
  const slice = createRouteSlice({}, { ...context(), chrome });

  assert.equal(slice.initialState.chrome, chrome);
  assert.deepEqual(slice.initialState.routes.myStats, { reportFeed: null });
  assert.equal(
    slice.reducer(slice.initialState, { type: 'ignored' }),
    slice.initialState
  );
});

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
  const tools = startTools();
  const slice = createRouteSlice({}, context(), {
    loadReportFeed: async (loadedAccount, options) => {
      account = loadedAccount;
      signal = options?.signal;
      return null;
    },
  });

  slice.start(tools);
  await Promise.resolve();

  assert.equal(account, tools.context.chrome.currentUser.id);
  assert.equal(signal, tools.signal);
});

test('my stats slice: dispatches a loaded Report Feed envelope', async () => {
  /** @type {unknown[]} */
  const dispatched = [];
  const slice = createRouteSlice({}, context(), {
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
