// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole } from './helpers/semantic-dom.js';

installDom();

const { createRouteSlice, myTeamColumns, myTeamView } =
  await import('../src/pages/cora-my-team.js');

const sources = [
  {
    slug: 'complaints',
    listName: 'Cases-Complaints',
    displayName: 'Complaints',
  },
  {
    slug: 'conduct',
    listName: 'Cases-Conduct',
    displayName: 'Conduct Reviews',
  },
];

/** @param {any} [client] */
function context(client = {}) {
  return /** @type {any} */ ({
    client,
    chrome: {
      toasts: [],
      nav: { currentHash: '#/my-team' },
      currentUser: { id: 'manager-1', displayName: 'Manager' },
      permissions: { isReviewerManager: true },
    },
    caseSources: sources,
  });
}

test('myTeamColumns: derives Case Type columns from resolved sources', () => {
  const columns = myTeamColumns(sources);
  assert.deepEqual(
    columns.map((column) => [column.key, column.label]),
    [
      ['reviewer', 'Reviewer'],
      ['case-type-complaints', 'Complaints'],
      ['case-type-conduct', 'Conduct Reviews'],
      ['totalOutstanding', 'Total outstanding'],
      ['onHold', 'On hold'],
      ['longestHoldDays', 'Longest hold (days)'],
    ]
  );
});

test('my team view: renders loading, errors, the workload table, and roster limitation', () => {
  const slice = createRouteSlice({}, context(), {
    fetchCases: async () => [],
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
  const tools = { dispatch() {}, caseSources: sources };

  const loading = myTeamView(slice.initialState, tools);
  assert.equal(loading.getAttribute('aria-busy'), 'true');
  assert.match(loading.textContent, /Loading current workload/);

  const failed = slice.reducer(slice.initialState, {
    type: 'workload/load-failed',
    message: 'Unable to read team Cases.',
  });
  assert.equal(
    myTeamView(failed, tools).querySelector('[role="alert"]')?.textContent,
    'Unable to read team Cases.'
  );

  const loaded = slice.reducer(slice.initialState, {
    type: 'workload/loaded',
    rows: [
      {
        reviewerId: 'reviewer-a',
        reviewer: 'reviewer-a',
        countsByCaseType: { complaints: 2, conduct: 1 },
        totalOutstanding: 3,
        onHold: 1,
        longestHoldDays: 4,
        isTotal: false,
      },
      {
        reviewerId: null,
        reviewer: 'Total',
        countsByCaseType: { complaints: 2, conduct: 1 },
        totalOutstanding: 3,
        onHold: 1,
        longestHoldDays: 4,
        isTotal: true,
      },
    ],
  });
  const view = myTeamView(loaded, tools);
  assert.equal(view.querySelector('h1')?.textContent, 'My Team');
  assert.match(view.textContent, /Current Workload/);
  assert.match(
    view.textContent,
    /only staff with allocated outstanding Cases/i
  );
  assert.equal(view.querySelector('tbody')?.querySelectorAll('tr').length, 1);
  assert.equal(view.querySelector('tfoot')?.querySelectorAll('tr').length, 1);
});

test('my team slice: loads fresh data, refreshes manually, sorts, and ignores stale completion', async () => {
  /** @type {any[]} */
  const actions = [];
  /** @type {Array<{ promise: Promise<any[]>, release: () => void }>} */
  const pending = [];
  const fetchCases = () => {
    /** @type {(rows: any[]) => void} */
    let resolve = () => {};
    const promise = new Promise((done) => {
      resolve = done;
    });
    pending.push({ promise, release: () => resolve([]) });
    return promise;
  };
  const slice = createRouteSlice({}, context(), {
    fetchCases: /** @type {any} */ (fetchCases),
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
  const dispose = slice.start?.({
    dispatch(action) {
      actions.push(action);
    },
    context: context(),
  });

  assert.deepEqual(actions[0], { type: 'workload/refresh-requested' });
  pending[0].release();
  await pending[0].promise;
  assert.equal(actions[1].type, 'workload/loaded');

  const loadedState = slice.reducer(slice.initialState, actions[1]);
  const rendered = slice.view?.(
    loadedState,
    /** @type {any} */ ({
      dispatch(/** @type {any} */ action) {
        actions.push(action);
      },
      context: context(),
    })
  );
  fireEvent(getByRole(rendered, 'button', { name: 'Refresh' }), 'click');
  assert.deepEqual(actions[2], { type: 'workload/refresh-requested' });

  const sorted = slice.reducer(slice.initialState, {
    type: 'table/sort-requested',
    key: 'reviewer',
  });
  assert.deepEqual(sorted.routes.myTeam.sort, {
    key: 'reviewer',
    dir: 'asc',
  });
  assert.equal(slice.reducer(sorted, { type: 'ignored' }), sorted);

  dispose?.();
  pending[1].release();
  await pending[1].promise;
  assert.equal(actions.length, 3);
});

test('my team view: keeps Total last under every sortable column and direction', () => {
  const slice = createRouteSlice({}, context(), {
    fetchCases: async () => [],
  });
  const loaded = slice.reducer(slice.initialState, {
    type: 'workload/loaded',
    rows: [
      {
        reviewerId: 'reviewer-z',
        reviewer: 'Zara Reviewer',
        countsByCaseType: { complaints: 1, conduct: 0 },
        totalOutstanding: 1,
        onHold: 0,
        longestHoldDays: null,
        isTotal: false,
      },
      {
        reviewerId: 'reviewer-a',
        reviewer: 'Alex Reviewer',
        countsByCaseType: { complaints: 0, conduct: 2 },
        totalOutstanding: 2,
        onHold: 1,
        longestHoldDays: 4,
        isTotal: false,
      },
      {
        reviewerId: null,
        reviewer: 'Total',
        countsByCaseType: { complaints: 1, conduct: 2 },
        totalOutstanding: 3,
        onHold: 1,
        longestHoldDays: 4,
        isTotal: true,
      },
    ],
  });

  for (const column of myTeamColumns(sources)) {
    for (const dir of /** @type {const} */ (['asc', 'desc'])) {
      const sorted = {
        ...loaded,
        routes: {
          myTeam: {
            ...loaded.routes.myTeam,
            sort: { key: column.key, dir },
          },
        },
      };
      const view = myTeamView(sorted, {
        dispatch() {},
        caseSources: sources,
      });
      assert.equal(
        view.querySelector('tfoot')?.querySelector('tr')?.textContent,
        'Total12314'
      );
      assert.equal(
        view.querySelector('tbody')?.querySelectorAll('tr').length,
        2
      );
    }
  }
});

test('my team slice: resolves reviewer display names and falls back to account ids', async () => {
  /** @type {any[]} */
  const actions = [];
  const client = {
    async resolveUsers(/** @type {string[]} */ accounts) {
      assert.deepEqual(accounts, ['reviewer-a', 'reviewer-b']);
      return { 'reviewer-a': 'Alex Reviewer', 'reviewer-b': null };
    },
  };
  const slice = createRouteSlice({}, context(), {
    fetchCases: async () => [
      /** @type {any} */ ({
        id: 'a',
        caseType: 'complaints',
        status: 'In-progress',
        assignedReviewer: 'reviewer-a',
      }),
      /** @type {any} */ ({
        id: 'b',
        caseType: 'conduct',
        status: 'Actions In Progress',
        assignedReviewer: 'reviewer-b',
      }),
    ],
  });

  slice.start?.({
    dispatch(/** @type {any} */ action) {
      actions.push(action);
    },
    context: context(client),
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(
    /** @type {any} */ (actions.at(-1)).rows.map((/** @type {any} */ row) => [
      row.reviewerId,
      row.reviewer,
    ]),
    [
      ['reviewer-a', 'Alex Reviewer'],
      ['reviewer-b', 'reviewer-b'],
      [null, 'Total'],
    ]
  );
  assert.equal(Object.hasOwn(slice.initialState, 'myTeamCaseSources'), false);
});
