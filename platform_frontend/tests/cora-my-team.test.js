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
    fetchVoidedCases: async () => [],
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
  let active = true;
  const dispose = slice.start?.({
    dispatch(action) {
      actions.push(action);
    },
    context: context(),
    isActive: () => active,
  });

  /** @param {string} type */
  const workloadActions = (type) =>
    actions.filter((action) => action.type === type);

  assert.deepEqual(actions[0], { type: 'workload/refresh-requested' });
  // Both reads are started inside their promise chain, so the fetcher is not
  // called until the microtask queue turns over.
  await Promise.resolve();
  pending[0].release();
  await pending[0].promise;
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  const loaded = workloadActions('workload/loaded');
  assert.equal(loaded.length, 1);

  // Both tables settled, so the page is idle and Refresh is offered.
  const loadedState = slice.reducer(
    slice.reducer(slice.initialState, loaded[0]),
    { type: 'void-volumes/loaded', rows: [] }
  );
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
  assert.equal(workloadActions('workload/refresh-requested').length, 2);

  const sorted = slice.reducer(slice.initialState, {
    type: 'workload-table/sort-requested',
    key: 'reviewer',
  });
  assert.deepEqual(sorted.routes.myTeam.sort, {
    key: 'reviewer',
    dir: 'asc',
  });
  assert.equal(slice.reducer(sorted, { type: 'ignored' }), sorted);

  await Promise.resolve();
  active = false;
  dispose?.();
  pending[1].release();
  await pending[1].promise;
  assert.equal(
    workloadActions('workload/loaded').length,
    1,
    'the load started before the mount ended lands nothing'
  );
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
    fetchVoidedCases: async () => [],
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
    isActive: () => true,
  });
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  const workloadLoaded = actions.filter(
    (/** @type {any} */ action) => action.type === 'workload/loaded'
  );
  assert.deepEqual(
    /** @type {any} */ (workloadLoaded.at(-1)).rows.map(
      (/** @type {any} */ row) => [row.reviewerId, row.reviewer]
    ),
    [
      ['reviewer-a', 'Alex Reviewer'],
      ['reviewer-b', 'reviewer-b'],
      [null, 'Total'],
    ]
  );
  assert.equal(Object.hasOwn(slice.initialState, 'myTeamCaseSources'), false);
});

test('my team slice: the adapter mount lifetime, not a page latch, suppresses a late load', async () => {
  /** @type {(rows: any[]) => void} */
  let releaseCases = () => {};
  const pending = new Promise((resolve) => {
    releaseCases = resolve;
  });
  const slice = createRouteSlice({}, context(), {
    fetchCases: /** @type {any} */ (() => pending),
    fetchVoidedCases: async () => [],
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
  /** @type {any[]} */
  const actions = [];
  let active = true;
  slice.start?.(
    /** @type {any} */ ({
      dispatch: (/** @type {any} */ action) => actions.push(action),
      context: context(),
      isActive: () => active,
    })
  );
  active = false;
  releaseCases([]);
  await pending;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    actions.filter((action) => action.type === 'workload/loaded'),
    []
  );
});

test('my team reducer: an unhandled action returns the same state and chrome survives a patch', () => {
  const slice = createRouteSlice({}, context(), { fetchCases: async () => [] });
  const initial = slice.initialState;

  assert.strictEqual(
    slice.reducer(initial, /** @type {any} */ ({ type: 'nothing/here' })),
    initial
  );

  const failed = slice.reducer(initial, {
    type: 'workload/load-failed',
    message: 'nope',
  });
  assert.strictEqual(failed.chrome, initial.chrome);
  assert.strictEqual(failed.routes.myTeam.rows, initial.routes.myTeam.rows);
});

test('my team view: clicking a column header dispatches the workload table sort action', () => {
  const slice = createRouteSlice({}, context(), {
    fetchCases: async () => [],
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
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
    ],
  });
  /** @type {any[]} */
  const actions = [];
  const view = myTeamView(loaded, {
    dispatch: (/** @type {any} */ action) => actions.push(action),
    caseSources: sources,
  });

  fireEvent(
    getByRole(view, 'button', { name: 'Longest hold (days)' }),
    'click'
  );
  assert.deepEqual(actions, [
    { type: 'workload-table/sort-requested', key: 'longestHoldDays' },
  ]);
});

test('my team slice: a client-less mount with a mount signal still degrades to the load-failed message', async () => {
  const ctx = context(null);
  const controller = new AbortController();
  /** @type {any[]} */
  const actions = [];
  /** @type {any[]} */
  const seenClients = [];
  const slice = createRouteSlice({}, ctx, {
    fetchCases: /** @type {any} */ (
      (/** @type {any} */ client) => {
        seenClients.push(client);
        return Promise.reject(new Error('No SharePoint client is available.'));
      }
    ),
  });

  // Binding the mount signal must not be what decides whether the route
  // survives a context with no client.
  assert.doesNotThrow(() =>
    slice.start?.(
      /** @type {any} */ ({
        dispatch: (/** @type {any} */ action) => actions.push(action),
        context: ctx,
        isActive: () => true,
        signal: controller.signal,
      })
    )
  );

  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.deepEqual(seenClients, [null], 'there was nothing to wrap');
  assert.deepEqual(
    actions.map((action) => action.type).sort(),
    [
      'void-volumes/load-failed',
      'void-volumes/refresh-requested',
      'workload/load-failed',
      'workload/refresh-requested',
    ],
    'both reads degrade to their own message'
  );
});

// --- Voided Cases: the second table on the page ---

test('my team view: the void volumes table renders beneath Current Workload', () => {
  const slice = createRouteSlice({}, context(), {
    fetchCases: async () => [],
    fetchVoidedCases: async () => [],
  });
  const tools = { dispatch() {}, caseSources: sources };

  const loaded = slice.reducer(
    slice.reducer(slice.initialState, { type: 'workload/loaded', rows: [] }),
    {
      type: 'void-volumes/loaded',
      rows: [
        {
          reviewerId: 'reviewer-a',
          reviewer: 'Alex Reviewer',
          last7: 1,
          last30: 3,
          countsByCaseType: { complaints: 2, conduct: 1 },
          leadingReason: 'Duplicate of another Case',
          isTotal: false,
        },
      ],
    }
  );
  const view = myTeamView(loaded, tools);

  assert.match(view.textContent, /Voided Cases/);
  assert.match(view.textContent, /Alex Reviewer/);
  assert.match(view.textContent, /Duplicate of another Case/);
  assert.ok(
    view.textContent.indexOf('Current Workload') <
      view.textContent.indexOf('Voided Cases'),
    'the workload the manager came for stays first'
  );
});

test('my team view: a failed void load leaves the workload table standing', () => {
  const slice = createRouteSlice({}, context(), {
    fetchCases: async () => [],
    fetchVoidedCases: async () => [],
  });
  const loaded = slice.reducer(
    slice.reducer(slice.initialState, {
      type: 'workload/loaded',
      rows: [
        {
          reviewerId: 'reviewer-a',
          reviewer: 'Alex Reviewer',
          countsByCaseType: { complaints: 1, conduct: 0 },
          totalOutstanding: 1,
          onHold: 0,
          longestHoldDays: null,
          isTotal: false,
        },
      ],
    }),
    {
      type: 'void-volumes/load-failed',
      message: 'Unable to read voided Cases.',
    }
  );
  const view = myTeamView(loaded, { dispatch() {}, caseSources: sources });

  const alerts = [...view.querySelectorAll('[role="alert"]')];
  assert.deepEqual(
    alerts.map((node) => node.textContent),
    ['Unable to read voided Cases.']
  );
  assert.equal(view.querySelector('tbody')?.querySelectorAll('tr').length, 1);
});

/**
 * A voided Case inside the report's window, attributed to `voidedBy`.
 * @param {string} voidedBy
 */
function voidedCase(voidedBy) {
  return /** @type {any} */ ({
    id: `case-${voidedBy}`,
    caseType: 'complaints',
    status: 'Void',
    voidedBy,
    voidedAt: '2026-07-20T00:00:00.000Z',
    voidReason: 'duplicate',
  });
}

test('my team slice: loads void volumes alongside the workload, and a read overtaken by a later one lands nothing', async () => {
  /** @type {any[]} */
  const actions = [];
  /** @type {Array<(rows: any[]) => void>} */
  const releases = [];
  /** @type {string[][]} */
  const resolveUserCalls = [];
  const client = {
    async resolveUsers(/** @type {string[]} */ accounts) {
      resolveUserCalls.push(accounts);
      return {};
    },
  };
  const ctx = context(client);
  const slice = createRouteSlice({}, ctx, {
    fetchCases: async () => [],
    fetchVoidedCases: () =>
      new Promise((resolve) => {
        releases.push(resolve);
      }),
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
  slice.start?.(
    /** @type {any} */ ({
      dispatch: (/** @type {any} */ action) => actions.push(action),
      context: ctx,
      isActive: () => true,
    })
  );

  assert.ok(
    actions.some((action) => action.type === 'void-volumes/refresh-requested')
  );
  await Promise.resolve();
  assert.equal(releases.length, 1, 'the mount started the first void read');

  // Refresh while the first read is still in flight, so two are genuinely open
  // at once — then answer the *second* one first.
  const idle = slice.reducer(
    slice.reducer(slice.initialState, { type: 'workload/loaded', rows: [] }),
    { type: 'void-volumes/loaded', rows: [] }
  );
  const rendered = slice.view?.(
    idle,
    /** @type {any} */ ({
      dispatch: (/** @type {any} */ action) => actions.push(action),
      context: ctx,
    })
  );
  fireEvent(getByRole(rendered, 'button', { name: 'Refresh' }), 'click');
  await Promise.resolve();
  assert.equal(releases.length, 2, 'refresh started a second void read');

  const voidLoads = () =>
    actions.filter((action) => action.type === 'void-volumes/loaded');

  releases[1]([voidedCase('fresh-reviewer')]);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  assert.deepEqual(
    voidLoads()
      .at(-1)
      .rows.map((/** @type {any} */ row) => row.reviewerId),
    ['fresh-reviewer', null],
    'the later read is the one on screen'
  );

  const landed = voidLoads().length;
  const enrichments = resolveUserCalls.length;
  releases[0]([voidedCase('stale-reviewer')]);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  assert.equal(
    voidLoads().length,
    landed,
    'the overtaken read dispatches nothing'
  );
  assert.equal(
    resolveUserCalls.length,
    enrichments,
    'and is abandoned before it does any directory work'
  );
});

test('my team slice: a void read overtaken while it resolves display names lands nothing', async () => {
  /** @type {any[]} */
  const actions = [];
  /** @type {Array<(rows: any[]) => void>} */
  const releases = [];
  // Directory enrichment is gated per request, so a read can be held *inside*
  // its own await while a later read overtakes it — the window the second
  // sequence check exists for.
  /** @type {Map<string, (names: any) => void>} */
  const nameGates = new Map();
  const client = {
    resolveUsers: (/** @type {string[]} */ accounts) =>
      new Promise((resolve) => nameGates.set(accounts.join(','), resolve)),
  };
  const ctx = context(client);
  const slice = createRouteSlice({}, ctx, {
    fetchCases: async () => [],
    fetchVoidedCases: () =>
      new Promise((resolve) => {
        releases.push(resolve);
      }),
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
  slice.start?.(
    /** @type {any} */ ({
      dispatch: (/** @type {any} */ action) => actions.push(action),
      context: ctx,
      isActive: () => true,
    })
  );

  await Promise.resolve();
  releases[0]([voidedCase('stale-reviewer')]);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  assert.ok(
    nameGates.has('stale-reviewer'),
    'the first read is mid-enrichment'
  );

  const idle = slice.reducer(
    slice.reducer(slice.initialState, { type: 'workload/loaded', rows: [] }),
    { type: 'void-volumes/loaded', rows: [] }
  );
  const rendered = slice.view?.(
    idle,
    /** @type {any} */ ({
      dispatch: (/** @type {any} */ action) => actions.push(action),
      context: ctx,
    })
  );
  fireEvent(getByRole(rendered, 'button', { name: 'Refresh' }), 'click');
  await Promise.resolve();
  releases[1]([voidedCase('fresh-reviewer')]);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  /** @type {any} */ (nameGates.get('fresh-reviewer'))({});
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  const voidLoads = () =>
    actions.filter((action) => action.type === 'void-volumes/loaded');
  assert.deepEqual(
    voidLoads()
      .at(-1)
      .rows.map((/** @type {any} */ row) => row.reviewerId),
    ['fresh-reviewer', null]
  );

  const landed = voidLoads().length;
  /** @type {any} */ (nameGates.get('stale-reviewer'))({});
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  assert.equal(
    voidLoads().length,
    landed,
    'the overtaken read does not dispatch on the far side of its await'
  );
});

test('my team slice: a client-less mount degrades both tables instead of throwing out of start', async () => {
  const ctx = context(null);
  /** @type {any[]} */
  const actions = [];
  // No fetcher stubs on purpose: the real fan-out touches the client the
  // moment it is called, so an effect that starts its read outside the promise
  // chain throws straight out of start() and takes the whole route with it.
  const slice = createRouteSlice({}, ctx, {
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });

  assert.doesNotThrow(() =>
    slice.start?.(
      /** @type {any} */ ({
        dispatch: (/** @type {any} */ action) => actions.push(action),
        context: ctx,
        isActive: () => true,
      })
    )
  );

  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.deepEqual(
    actions.map((action) => action.type).sort(),
    [
      'void-volumes/load-failed',
      'void-volumes/refresh-requested',
      'workload/load-failed',
      'workload/refresh-requested',
    ],
    'both tables report their own failure'
  );
});

test('my team view: Refresh stays busy until both tables have finished loading', () => {
  const slice = createRouteSlice({}, context(), {
    fetchCases: async () => [],
    fetchVoidedCases: async () => [],
  });
  const tools = { dispatch() {}, caseSources: sources };

  const workloadOnly = slice.reducer(slice.initialState, {
    type: 'workload/loaded',
    rows: [],
  });
  const waiting = myTeamView(workloadOnly, tools);
  assert.equal(waiting.getAttribute('aria-busy'), 'true');
  assert.equal(
    getByRole(waiting, 'button', { name: 'Refreshing…' }).disabled,
    true,
    'the void read is still in flight'
  );

  const bothDone = slice.reducer(workloadOnly, {
    type: 'void-volumes/loaded',
    rows: [],
  });
  const settled = myTeamView(bothDone, tools);
  assert.equal(settled.getAttribute('aria-busy'), 'false');
  assert.equal(
    getByRole(settled, 'button', { name: 'Refresh' }).disabled,
    false
  );
});

test('my team slice: the two tables sort independently', () => {
  const slice = createRouteSlice({}, context(), {
    fetchCases: async () => [],
    fetchVoidedCases: async () => [],
  });
  const sorted = slice.reducer(slice.initialState, {
    type: 'void-volumes-table/sort-requested',
    key: 'last30',
  });
  assert.deepEqual(sorted.routes.myTeam.voidSort, {
    key: 'last30',
    dir: 'asc',
  });
  assert.equal(
    sorted.routes.myTeam.sort,
    null,
    'the workload sort is untouched'
  );

  const workloadSorted = slice.reducer(sorted, {
    type: 'workload-table/sort-requested',
    key: 'reviewer',
  });
  assert.deepEqual(workloadSorted.routes.myTeam.voidSort, {
    key: 'last30',
    dir: 'asc',
  });
});

test('my team slice: a void load failure leaves the workload slice untouched', () => {
  const slice = createRouteSlice({}, context(), {
    fetchCases: async () => [],
    fetchVoidedCases: async () => [],
  });
  const withWorkload = slice.reducer(slice.initialState, {
    type: 'workload/loaded',
    rows: [],
  });
  const failed = slice.reducer(withWorkload, {
    type: 'void-volumes/load-failed',
    message: 'nope',
  });

  assert.deepEqual(failed.routes.myTeam.rows, []);
  assert.equal(failed.routes.myTeam.error, null);
  assert.equal(failed.routes.myTeam.loading, false);
  assert.equal(failed.routes.myTeam.voidError, 'nope');
});
