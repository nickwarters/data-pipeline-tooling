import test from 'node:test';
import assert from 'node:assert/strict';

import { createDebouncedPeopleSearch } from '../src/lib/people-search.js';

/**
 * Build a search under test with recorders for both sides of it: the queries
 * that reached the client, and the states that reached the page.
 *
 * @param {{
 *   searchPeople?: (query: string) => Promise<any[]>,
 *   client?: any,
 * }} [options]
 */
function makeSearch(options = {}) {
  /** @type {string[]} */
  const searches = [];
  /** @type {Array<{ key: string, query: string, people: any[], status: string }>} */
  const states = [];
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
    onState: (key, state) => {
      states.push({ key, ...state });
    },
  });
  return {
    search,
    searches,
    states,
    /** Outcomes after the request has started and loading has been reported. */
    resolved() {
      return states.filter((entry) => entry.status !== 'loading');
    },
    /**
     * Await the client calls themselves, rather than a guessed number of
     * microtask turns: the effect's handlers are attached to each of these
     * before this `Promise.all` is, so they have already run once this settles.
     */
    async settle() {
      await Promise.allSettled(inflight);
    },
    /** @param {boolean} value */
    setActive(value) {
      active = value;
    },
  };
}

test('nothing is searched before the delay, and one search lands at it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, resolved, settle } = makeSearch();

  search.request('q1', 'Jane');
  t.mock.timers.tick(199);
  assert.deepEqual(searches, []);

  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(searches, ['Jane']);
  assert.deepEqual(resolved(), [
    {
      key: 'q1',
      query: 'Jane',
      people: [{ loginName: 'Jane' }],
      status: 'success',
    },
  ]);
});

test('overtaken queries report neither loading nor a client call', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, states, settle } = makeSearch();

  search.request('q1', 'Ja');
  t.mock.timers.tick(199);
  search.request('q1', 'Jane');
  t.mock.timers.tick(199);

  assert.deepEqual(searches, []);
  assert.deepEqual(states, []);
  return settle();
});

test('the surviving query reports loading once at the timer, then success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, states, settle } = makeSearch();

  search.request('q1', 'Ja');
  t.mock.timers.tick(150);
  search.request('q1', 'Jane');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, ['Jane']);
  assert.deepEqual(states, [
    { key: 'q1', query: 'Jane', people: [], status: 'loading' },
    {
      key: 'q1',
      query: 'Jane',
      people: [{ loginName: 'Jane' }],
      status: 'success',
    },
  ]);
});

test('the client is sent the trimmed query, the caller is told the one it asked for', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, resolved, settle } = makeSearch();

  search.request('q1', '  Jane  ');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, ['Jane']);
  assert.equal(resolved()[0].query, '  Jane  ');
});

test('empty and whitespace-only queries schedule nothing and report idle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, states, settle } = makeSearch();

  search.request('q1', '');
  search.request('q2', '   ');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, []);
  assert.deepEqual(states, [
    { key: 'q1', query: '', people: [], status: 'idle' },
    { key: 'q2', query: '   ', people: [], status: 'idle' },
  ]);
});

test('a falsy client schedules nothing and reports the search as failed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, states, settle } = makeSearch({ client: null });

  search.request('q1', 'Jane');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(states, [
    { key: 'q1', query: 'Jane', people: [], status: 'error' },
  ]);
});

// A rejection that escaped instead would also fail this file outright: the node
// test runner reports an unhandled rejection as a failing test, which is the
// backstop against the defect this replaced.
test('a failed search is reported as an error, not left as a pending load', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, states, resolved, settle } = makeSearch({
    searchPeople: async () => {
      throw new Error('HTTP Error: 400');
    },
  });

  search.request('q1', '  Jane  ');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(states, [
    { key: 'q1', query: '  Jane  ', people: [], status: 'loading' },
    { key: 'q1', query: '  Jane  ', people: [], status: 'error' },
  ]);
  assert.deepEqual(resolved(), [
    { key: 'q1', query: '  Jane  ', people: [], status: 'error' },
  ]);
});

test('a result that resolves after the mount ends is not reported', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {(people: any[]) => void} */
  let resolveSearch = () => {};
  const { search, resolved, settle, setActive } = makeSearch({
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

  assert.deepEqual(resolved(), []);
});

test('a failure that lands after the mount ends is not reported either', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {(reason: any) => void} */
  let rejectSearch = () => {};
  const { search, resolved, settle, setActive } = makeSearch({
    searchPeople: () =>
      new Promise((_resolve, reject) => {
        rejectSearch = reject;
      }),
  });

  search.request('q1', 'Late');
  t.mock.timers.tick(200);
  setActive(false);
  rejectSearch(new Error('HTTP Error: 400'));
  await settle();

  assert.deepEqual(resolved(), []);
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
  const { search, searches, resolved, settle } = makeSearch();

  search.request('q1', 'Jane');
  search.request('q2', 'John');
  t.mock.timers.tick(200);
  await settle();

  assert.deepEqual(searches, ['Jane', 'John']);
  assert.deepEqual(
    resolved().map((entry) => [entry.key, entry.query, entry.people]),
    [
      ['q1', 'Jane', [{ loginName: 'Jane' }]],
      ['q2', 'John', [{ loginName: 'John' }]],
    ]
  );
});

test('a single constant key holds one entry, cleared and disposed like any other', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { search, searches, resolved, settle } = makeSearch();

  search.request('only', 'Ja');
  search.request('only', 'Jane');
  t.mock.timers.tick(200);
  await settle();
  assert.deepEqual(searches, ['Jane']);
  assert.deepEqual(resolved(), [
    {
      key: 'only',
      query: 'Jane',
      people: [{ loginName: 'Jane' }],
      status: 'success',
    },
  ]);

  search.request('only', 'Cancelled');
  search.clear('only');
  t.mock.timers.tick(200);
  await settle();
  assert.deepEqual(searches, ['Jane']);
});
