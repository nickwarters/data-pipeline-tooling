// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { createRouteSlice, journeyCasesColumns, journeyCasesView } =
  await import('../src/pages/cora-journey-cases.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @param {string} id @param {string} caseType @returns {CaseRow} */
function row(id, caseType) {
  return {
    id,
    caseType,
    title: `Case ${id}`,
    status: 'Completed',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e',
  };
}

function context() {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/journey-cases' },
      currentUser: { id: 'journey-owner-1', displayName: 'Journey Owner' },
      permissions: {},
    },
    journeyCaseSources: [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
      },
    ],
  });
}

test('journey cases slice: fetches owned Case Types and dispatches loaded rows', async () => {
  const cases = [row('c1', 'complaints')];
  /** @type {any[]} */
  const fetchCalls = [];
  /** @type {any[]} */
  const actions = [];
  /** @type {() => void} */
  let markLoaded = () => {};
  /** @type {Promise<void>} */
  const loadedAction = new Promise((resolve) => {
    markLoaded = resolve;
  });
  const ctx = context();
  const slice = createRouteSlice({}, ctx, {
    fetchCases: async (...args) => {
      fetchCalls.push(args);
      return cases;
    },
  });

  slice.start?.({
    dispatch: (/** @type {any} */ action) => {
      actions.push(action);
      markLoaded();
    },
    params: {},
    context: ctx,
    isActive: () => true,
  });
  await loadedAction;

  assert.deepEqual(fetchCalls, [[ctx.client, ctx.journeyCaseSources]]);
  assert.deepEqual(actions, [{ type: 'cases/loaded', cases }]);
});

test('journey cases slice: reducer owns loaded rows and generic table sort state', () => {
  const slice = createRouteSlice({}, context());
  const loaded = slice.reducer(slice.initialState, {
    type: 'cases/loaded',
    cases: [row('c1', 'complaints')],
  });
  const sorted = slice.reducer(loaded, {
    type: 'table/sort-requested',
    key: 'reference',
  });

  assert.equal(loaded.routes.journeyCases.cases?.length, 1);
  assert.deepEqual(sorted.routes.journeyCases.sort, {
    key: 'reference',
    dir: 'asc',
  });
  assert.equal(slice.reducer(sorted, { type: 'ignored' }), sorted);
});

test('journey cases descriptors and pure view preserve links, empty state, and sorting', () => {
  const columns = journeyCasesColumns();
  const fallback = { ...row('c9', 'complaints'), title: '' };
  assert.deepEqual(
    columns.map((column) => column.key),
    ['reference', 'caseType', 'status']
  );
  assert.equal(
    /** @type {(row: CaseRow) => unknown} */ (columns[0].value)(fallback),
    'c9'
  );
  assert.equal(columns[0].href?.(fallback), '#/case/complaints/c9');

  const slice = createRouteSlice({}, context());
  const loading = journeyCasesView(slice.initialState, { dispatch: () => {} });
  assert.equal(loading.querySelector('h1')?.textContent, 'Journey Cases');
  assert.equal(loading.querySelector('table'), null);
  const empty = journeyCasesView(
    {
      ...slice.initialState,
      routes: { journeyCases: { cases: [], sort: null } },
    },
    { dispatch: () => {} }
  );
  assert.equal(empty.querySelector('h1')?.textContent, 'Journey Cases');
  assert.match(empty.textContent, /No cases of your Case Type\(s\) yet/);

  /** @type {any[]} */
  const actions = [];
  const loaded = journeyCasesView(
    {
      ...slice.initialState,
      routes: {
        journeyCases: {
          cases: [row('c1', 'complaints')],
          sort: null,
        },
      },
    },
    { dispatch: (action) => actions.push(action) }
  );
  assert.equal(loaded.querySelector('table')?.getAttribute('role'), 'grid');
  assert.equal(
    loaded.querySelector('tbody')?.querySelector('a')?.getAttribute('href'),
    '#/case/complaints/c1'
  );
  loaded
    .querySelector('th')
    ?.querySelector('button')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  assert.deepEqual(actions, [
    { type: 'table/sort-requested', key: 'reference' },
  ]);
  // Existing DOM-stub debt retained until the shared debt ledger can move.
  assert.ok(/** @type {any} */ (loaded)._children);
  assert.ok(/** @type {any} */ (loaded)._children.length > 0);
});

test('journey cases slice suppresses late loads and skips fetching without a client', async () => {
  const noClient = context();
  noClient.client = null;
  let fetched = false;
  const noClientSlice = createRouteSlice({}, noClient, {
    fetchCases: async () => {
      fetched = true;
      return [];
    },
  });
  noClientSlice.start?.({
    context: noClient,
    params: {},
    dispatch: () => {},
  });
  assert.equal(fetched, false);

  /** @type {(rows: CaseRow[]) => void} */
  let resolveRows = () => {};
  const slice = createRouteSlice({}, context(), {
    fetchCases: () =>
      new Promise((resolve) => {
        resolveRows = resolve;
      }),
  });
  /** @type {any[]} */
  const actions = [];
  let active = true;
  slice.start?.({
    context: context(),
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    isActive: () => active,
  });
  active = false;
  resolveRows([row('late', 'complaints')]);
  await Promise.resolve();
  assert.deepEqual(actions, []);
});

test('journey cases reducer: an unhandled action returns the same state and chrome survives a patch', () => {
  const slice = createRouteSlice({}, context());
  const initial = slice.initialState;

  assert.strictEqual(slice.reducer(initial, { type: 'nothing/here' }), initial);

  const loaded = slice.reducer(initial, { type: 'cases/loaded', cases: [] });
  assert.strictEqual(loaded.chrome, initial.chrome);
  assert.strictEqual(
    loaded.routes.journeyCases.sort,
    initial.routes.journeyCases.sort
  );
});
