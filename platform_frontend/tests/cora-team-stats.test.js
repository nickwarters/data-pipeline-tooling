// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeChrome } from './helpers/fixtures.js';

installDom();

const { createRouteSlice, teamStatsView } =
  await import('../src/pages/cora-team-stats.js');

function context() {
  return /** @type {any} */ ({
    chrome: makeChrome(),
  });
}

test('team stats view: renders an accessible heading and the empty state copy', () => {
  const view = teamStatsView(
    /** @type {any} */ ({ chrome: makeChrome(), routes: { teamStats: {} } })
  );

  assert.equal(view.tagName, 'MAIN');
  assert.equal(view.querySelector('h1')?.textContent, 'Team Stats');
  const empty = view.querySelector('.cora-team-stats-empty');
  assert.ok(empty);
  assert.equal(empty.textContent, 'No data yet.');
});

test('team stats slice: keeps shared chrome, empty route state, and reducer identity', () => {
  const chrome = makeChrome();
  const slice = createRouteSlice({}, { ...context(), chrome });

  assert.equal(slice.initialState.chrome, chrome);
  assert.deepEqual(slice.initialState.routes.teamStats, {});
  assert.equal(
    slice.reducer(slice.initialState, { type: 'ignored' }),
    slice.initialState
  );
});

test('team stats slice: has no start effect or client loading', () => {
  const slice = createRouteSlice({}, context());

  assert.equal(/** @type {any} */ (slice).start, undefined);
});
