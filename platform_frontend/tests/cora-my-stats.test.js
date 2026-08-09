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
    /** @type {any} */ ({ chrome: makeChrome(), routes: { myStats: {} } })
  );

  assert.equal(view.tagName, 'MAIN');
  assert.equal(view.querySelector('h1')?.textContent, 'My Stats');
  const empty = view.querySelector('.cora-my-stats-empty');
  assert.ok(empty);
  assert.equal(empty.textContent, 'No data yet.');
});

test('my stats slice: keeps shared chrome, empty route state, and reducer identity', () => {
  const chrome = makeChrome();
  const slice = createRouteSlice({}, { ...context(), chrome });

  assert.equal(slice.initialState.chrome, chrome);
  assert.deepEqual(slice.initialState.routes.myStats, {});
  assert.equal(
    slice.reducer(slice.initialState, { type: 'ignored' }),
    slice.initialState
  );
});

test('my stats slice: has no start effect or client loading', () => {
  const client = {
    listCases() {
      throw new Error('client loading is not part of this page');
    },
  };
  const slice = createRouteSlice({}, context(client));

  assert.equal(/** @type {any} */ (slice).start, undefined);
});
