import test from 'node:test';
import assert from 'node:assert/strict';

import { createDebouncedPeopleSearch } from '../src/pages/cora-case-review/people-search-effects.js';

/**
 * Build a search under test with recorders for both sides of it: the queries
 * that reached the client, and the results that reached the page.
 *
 * @param {{
 *   searchPeople?: (query: string) => Promise<any[]>,
 *   client?: any,
 * }} [options]
 */
function makeSearch(options = {}) {
  /** @type {string[]} */
  const searches = [];
  /** @type {Array<{ key: string, query: string, people: any[] }>} */
  const results = [];
  /** @type {Promise<any[]>[]} */
  const inflight = [];
  let active = true;
  const searchPeople =
    options.searchPeople ??
    (async (/** @type {string} */ query) => [{ loginName: query }]);
  const client =
    'client' in options
      ? options.client
      : {
          searchPeople: (/** @type {string} */ query) => {
            searches.push(query);
            const pending = searchPeople(query);
            inflight.push(pending);
            return pending;
          },
        };
  const search = createDebouncedPeopleSearch({
    client,
    isActive: () => active,
    onResults: (key, query, people) => {
      results.push({ key, query, people });
    },
  });
  return {
    search,
    searches,
    results,
    /**
     * Await the client calls themselves, rather than a guessed number of
     * microtask turns: the effect's `then` is attached to each of these before
     * this `Promise.all` is, so it has already run once this resolves.
     */
    async settle() {
      await Promise.all(inflight);
    },
    /** @param {boolean} value */
    setActive(value) {
      active = value;
    },
  };
}

test('nothing is searched before the delay, and one search lands at it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, results, settle } = makeSearch();

  search.request('q1', 'Jane');
  t.mock.timers.tick(199);
  assert.deepEqual(searches, []);

  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(searches, ['Jane']);
  assert.deepEqual(results, [
    { key: 'q1', query: 'Jane', people: [{ loginName: 'Jane' }] },
  ]);
});

test('retyping inside the window searches only the last query', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, settle } = makeSearch();

  search.request('q1', 'Ja');
  t.mock.timers.tick(150);
  search.request('q1', 'Jane');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, ['Jane']);
});

test('the client is sent the trimmed query, the caller is told the one it asked for', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, results, settle } = makeSearch();

  search.request('q1', '  Jane  ');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, ['Jane']);
  assert.equal(results[0].query, '  Jane  ');
});

test('empty and whitespace-only queries schedule nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, settle } = makeSearch();

  search.request('q1', '');
  search.request('q2', '   ');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, []);
});

test('a falsy client schedules nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, results, settle } = makeSearch({ client: null });

  search.request('q1', 'Jane');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(results, []);
});

test('a result that resolves after the mount ends is not reported', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {(people: any[]) => void} */
  let resolveSearch = () => {};
  const { search, results, settle, setActive } = makeSearch({
    searchPeople: () =>
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
  });

  search.request('q1', 'Late');
  t.mock.timers.tick(200);
  setActive(false);
  resolveSearch([{ loginName: 'late' }]);
  await settle();

  assert.deepEqual(results, []);
});

test('clear cancels that key’s pending timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, settle } = makeSearch();

  search.request('q1', 'Pending');
  search.request('q2', 'Kept');
  search.clear('q1');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, ['Kept']);
});

test('clear on a key with no pending timer is a no-op', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, settle } = makeSearch();

  search.clear('never-typed');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, []);
});

test('dispose cancels every pending timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, settle } = makeSearch();

  search.request('q1', 'One');
  search.request('q2', 'Two');
  search.dispose();
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, []);
});

test('two keys typed in the same window each report their own results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, results, settle } = makeSearch();

  search.request('q1', 'Jane');
  search.request('q2', 'John');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, ['Jane', 'John']);
  assert.deepEqual(
    results.map((entry) => [entry.key, entry.query, entry.people]),
    [
      ['q1', 'Jane', [{ loginName: 'Jane' }]],
      ['q2', 'John', [{ loginName: 'John' }]],
    ]
  );
});

test('a single constant key holds one entry, cleared and disposed like any other', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, results, settle } = makeSearch();

  search.request('only', 'Ja');
  search.request('only', 'Jane');
  t.mock.timers.tick(200);
  await settle();
  assert.deepEqual(searches, ['Jane']);
  assert.deepEqual(results, [
    { key: 'only', query: 'Jane', people: [{ loginName: 'Jane' }] },
  ]);

  search.request('only', 'Cancelled');
  search.clear('only');
  t.mock.timers.tick(200);
  await settle();
  assert.deepEqual(searches, ['Jane']);
});
