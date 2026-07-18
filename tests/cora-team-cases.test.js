// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const {
  createRouteSlice,
  resolveDashboardColumns,
  teamCasesColumns,
  teamCasesView,
} = await import('../src/pages/cora-team-cases.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @param {string} id @returns {CaseRow} */
function row(id) {
  return /** @type {CaseRow} */ ({
    id,
    caseType: 'complaints',
    title: `Case ${id}`,
    status: 'In-progress',
    assignedReviewer: 'r',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e',
  });
}

function context() {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/team-cases' },
      currentUser: { id: 'manager-1', displayName: 'Manager' },
      permissions: {},
    },
    caseSources: [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
      },
    ],
  });
}

test('team cases slice: fetches with parsed route params and dispatches loaded data', async () => {
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
  const cases = [row('c1')];
  const dashboardColumns = [
    { key: 'owner', label: 'Owner', value: 'responsibleParty' },
  ];
  const slice = createRouteSlice(
    {
      queryString: '?manager=me&role=reviewer-manager&caseType=complaints',
    },
    context(),
    {
      fetchCases: async (...args) => {
        fetchCalls.push(args);
        return cases;
      },
      resolveColumns: async () => dashboardColumns,
    }
  );

  const dispose = slice.start?.({
    dispatch: (action) => {
      actions.push(action);
      markLoaded();
    },
    params: {
      queryString: '?manager=me&role=reviewer-manager&caseType=complaints',
    },
    context: context(),
  });
  await loadedAction;

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0][1].caseType, 'complaints');
  assert.equal(fetchCalls[0][2], 'manager-1');
  assert.deepEqual(actions[0], {
    type: 'cases/loaded',
    cases,
    dashboardColumns,
  });
  dispose?.();
});

test('team cases slice: reducer owns loaded rows and generic table sort state', () => {
  const slice = createRouteSlice({}, context());
  const loaded = slice.reducer(slice.initialState, {
    type: 'cases/loaded',
    cases: [row('c1')],
    dashboardColumns: [],
  });
  const sorted = slice.reducer(loaded, {
    type: 'table/sort-requested',
    key: 'reference',
  });

  assert.equal(loaded.routes.teamCases.cases?.length, 1);
  assert.deepEqual(sorted.routes.teamCases.sort, {
    key: 'reference',
    dir: 'asc',
  });
  assert.equal(slice.reducer(sorted, { type: 'ignored' }), sorted);
});

test('team cases descriptors retain the Case link, sortable columns, and Case Type additions', () => {
  const columns = teamCasesColumns([
    { key: 'owner', label: 'Owner', value: 'responsibleParty' },
  ]);

  assert.deepEqual(
    columns.map((column) => column.key),
    [
      'reference',
      'caseType',
      'relatedDate',
      'dueDate',
      'status',
      'assigned',
      'actions',
      'owner',
    ]
  );
  assert.equal(columns.filter((column) => column.sortable).length, 6);
  assert.equal(columns[0].href?.(row('c1')), '#/case/complaints/c1');
});

test('team cases descriptors preserve legacy empty-date sort values', () => {
  const columns = teamCasesColumns();
  const missingDates = row('c1');
  for (const key of ['relatedDate', 'dueDate', 'assigned']) {
    const column = columns.find((candidate) => candidate.key === key);
    assert.equal(typeof column?.value, 'function');
    assert.equal(
      /** @type {(row: CaseRow) => unknown} */ (column?.value)(missingDates),
      ''
    );
  }
});

test('team cases columns: mixed and unknown Case Types have no extension columns', async () => {
  let mixedLoadCalled = false;
  assert.deepEqual(
    await resolveDashboardColumns(null, async () => {
      mixedLoadCalled = true;
      throw new Error('mixed view must not load one Case Type');
    }),
    []
  );
  assert.equal(mixedLoadCalled, false);
  assert.deepEqual(
    await resolveDashboardColumns('unknown-case-type-for-test'),
    []
  );
});

test('team cases columns: unexpected Case Type loading failures rethrow', async () => {
  const failure = new Error('config unavailable');
  await assert.rejects(
    resolveDashboardColumns('complaints', async () => {
      throw failure;
    }),
    failure
  );
});

test('team cases view: keeps heading, back link, empty state, and row links', () => {
  const slice = createRouteSlice({}, context());
  const empty = teamCasesView(
    {
      ...slice.initialState,
      routes: {
        teamCases: {
          cases: [],
          dashboardColumns: [],
          sort: null,
        },
      },
    },
    { dispatch: () => {} }
  );
  assert.equal(empty.querySelector('h1')?.textContent, 'Team Cases');
  assert.equal(empty.querySelector('a')?.getAttribute('href'), '#/reports');
  assert.match(empty.textContent, /No cases match the selected filters/);

  /** @type {any[]} */
  const actions = [];
  const loaded = teamCasesView(
    {
      ...slice.initialState,
      routes: {
        teamCases: {
          cases: [row('c1')],
          dashboardColumns: [],
          sort: null,
        },
      },
    },
    { dispatch: (action) => actions.push(action) }
  );
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
});

test('team cases slice: cleanup suppresses a late fetch result', async () => {
  /** @type {(rows: CaseRow[]) => void} */
  let resolveFetch = () => {};
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice({}, context(), {
    fetchCases: () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    resolveColumns: async () => [],
  });
  const dispose = slice.start?.({
    dispatch: (action) => actions.push(action),
    params: {},
    context: context(),
  });

  dispose?.();
  resolveFetch([row('late')]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(actions, []);
});
