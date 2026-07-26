// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole, tableHeaders } from './helpers/semantic-dom.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { createRouteSlice, dashboardView } =
  await import('../src/pages/cora-dashboard.js');

function capabilities(overrides = {}) {
  return /** @type {any} */ ({
    isReviewer: false,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
    ...overrides,
  });
}

/** @param {any} permissions */
function context(permissions) {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/dashboard' },
      currentUser: { id: 'u1', displayName: 'User' },
      permissions,
    },
    caseSources: [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        displayName: 'Complaints',
      },
    ],
    allocationSources: [
      {
        slug: 'complaints',
        listName: 'Cases-Complaints',
        maxInProgressCases: 3,
      },
    ],
    appEl: document.createElement('main'),
  });
}

test('dashboard slice: effects load reviewer rows, KPI lanes, and Controls appeals through actions', async () => {
  const caps = capabilities({ isReviewer: true, isControls: true });
  const ctx = context(caps);
  const reviewer = [{ id: 'reviewer-case', dueDate: '2020-01-01T00:00:00Z' }];
  const appeals = [{ id: 'appeal-case' }];
  const lanes = [
    {
      role: 'reviewer',
      label: 'As Reviewer',
      scopeLabel: 'Complaints',
      isPrimary: true,
      defaultOpen: true,
      totalItems: 1,
      tiles: [],
    },
  ];
  /** @type {any[]} */
  const actions = [];
  /** @type {any[]} */
  const reviewerSources = [];
  /** @type {() => void} */
  let markLoaded = () => {};
  /** @type {Promise<void>} */
  const loaded = new Promise((resolve) => {
    markLoaded = resolve;
  });
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      listAcrossSources: async (
        /** @type {any} */ _client,
        /** @type {any[]} */ caseSources
      ) => {
        reviewerSources.push(...caseSources);
        return /** @type {any} */ (reviewer);
      },
      loadAppeals: async () => /** @type {any} */ (appeals),
      loadKpis: async () => /** @type {any} */ (lanes),
    })
  );
  slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => {
      actions.push(action);
      if (actions.length === 3) markLoaded();
    },
    listen: (
      /** @type {any} */ target,
      /** @type {string} */ type,
      /** @type {any} */ listener
    ) => target.addEventListener(type, listener),
    isActive: () => true,
  });
  await loaded;

  assert.deepEqual(actions.map((action) => action.type).sort(), [
    'appeals/loaded',
    'kpis/loaded',
    'reviewer-cases/loaded',
  ]);
  assert.equal(
    actions.find((action) => action.type === 'reviewer-cases/loaded').cases[0]
      .overdue,
    true
  );
  assert.deepEqual(reviewerSources, ctx.caseSources);
});

test('dashboard reducer owns KPI disclosure and table sort state', () => {
  const slice = createRouteSlice({}, context(capabilities()));
  const withLane = slice.reducer(slice.initialState, {
    type: 'kpis/loaded',
    lanes: [
      {
        role: 'owner',
        defaultOpen: true,
        tiles: [{ key: 'at-risk', defaultExpanded: true }],
      },
    ],
  });
  const closed = slice.reducer(withLane, {
    type: 'kpi/lane-toggled',
    role: 'owner',
  });
  const sorted = slice.reducer(closed, {
    type: 'reviewer-table/sort-requested',
    key: 'reference',
  });
  const opened = slice.reducer(slice.initialState, {
    type: 'kpi/lane-toggled',
    role: 'owner',
  });
  const tileClosed = slice.reducer(withLane, {
    type: 'kpi/tile-toggled',
    role: 'owner',
    key: 'at-risk',
  });

  assert.equal(withLane.routes.dashboard.openKpiLanes.has('owner'), true);
  assert.equal(
    withLane.routes.dashboard.expandedKpiTiles.has('owner:at-risk'),
    true
  );
  assert.equal(closed.routes.dashboard.openKpiLanes.has('owner'), false);
  assert.equal(opened.routes.dashboard.openKpiLanes.has('owner'), true);
  assert.equal(
    tileClosed.routes.dashboard.expandedKpiTiles.has('owner:at-risk'),
    false
  );
  assert.deepEqual(sorted.routes.dashboard.reviewerSort, {
    key: 'reference',
    dir: 'asc',
  });
});

test('reviewer worklist preserves the legacy columns, filters, and Open action', () => {
  const ctx = context(capabilities({ isReviewer: true }));
  ctx.client = null;
  const slice = createRouteSlice({}, ctx);
  const cases = [
    {
      id: 'alpha',
      title: 'Alpha case',
      caseType: 'complaints',
      status: 'In-progress',
      relatedDate: '2026-01-01',
      dueDate: '2026-01-10',
      created: 'reviewer-a',
      overdue: false,
    },
    {
      id: 'beta',
      title: 'Beta case',
      caseType: 'conduct',
      status: 'Completed',
      relatedDate: '2026-02-01',
      dueDate: '2026-02-10',
      created: 'reviewer-b',
      overdue: false,
    },
    {
      id: 'fallback-reference',
      title: '',
      caseType: 'complaints',
      status: 'In-progress',
      relatedDate: '',
      dueDate: '',
      created: '',
      overdue: false,
    },
  ];
  const loaded = slice.reducer(slice.initialState, {
    type: 'reviewer-cases/loaded',
    cases,
  });
  const unfiltered = dashboardView(/** @type {any} */ (loaded), {
    context: ctx,
    dispatch: () => {},
  });
  assert.match(unfiltered.textContent, /Alpha case/);
  assert.match(unfiltered.textContent, /Beta case/);
  assert.match(unfiltered.textContent, /fallback-reference/);
  assert.deepEqual(tableHeaders(unfiltered), [
    ['Reference', 'cora-col-reference', 'none', true],
    ['Case Type', 'cora-col-caseType', 'none', true],
    ['Related Date', 'cora-col-relatedDate', 'none', true],
    ['Due Date', 'cora-col-dueDate', 'none', true],
    ['Status', 'cora-col-status', 'none', true],
    ['Assigned', 'cora-col-assigned', 'none', true],
    ['Actions', 'cora-col-actions', 'none', false],
  ]);
  const sortedByReference = dashboardView(
    /** @type {any} */ (
      slice.reducer(loaded, {
        type: 'reviewer-table/sort-requested',
        key: 'reference',
      })
    ),
    { context: ctx, dispatch: () => {} }
  );
  assert.deepEqual(
    tableHeaders(sortedByReference).map((header) => header[2]),
    ['ascending', 'none', 'none', 'none', 'none', 'none', 'none']
  );

  const byCaseType = slice.reducer(loaded, {
    type: 'reviewer-table/filter-text-changed',
    value: 'complaints',
  });
  assert.match(
    dashboardView(/** @type {any} */ (byCaseType), {
      context: ctx,
      dispatch: () => {},
    }).textContent,
    /Alpha case/
  );
  const byStatus = slice.reducer(loaded, {
    type: 'reviewer-table/filter-text-changed',
    value: 'completed',
  });
  assert.match(
    dashboardView(/** @type {any} */ (byStatus), {
      context: ctx,
      dispatch: () => {},
    }).textContent,
    /Beta case/
  );

  let state = slice.reducer(loaded, {
    type: 'reviewer-table/filter-text-changed',
    value: 'beta',
  });
  state = slice.reducer(state, {
    type: 'reviewer-table/status-filter-changed',
    value: 'Completed',
  });
  /** @type {any[]} */
  const actions = [];
  const view = dashboardView(/** @type {any} */ (state), {
    context: ctx,
    dispatch: (/** @type {any} */ action) => actions.push(action),
  });

  assert.match(view.textContent, /Beta case/);
  assert.doesNotMatch(view.textContent, /Alpha case/);
  assert.equal(view.querySelectorAll('th').length, 7);
  const textFilter = /** @type {any} */ (
    view.querySelector('[aria-label="Filter cases"]')
  );
  textFilter.value = 'conduct';
  textFilter.dispatchEvent({ type: 'input', target: textFilter });
  const statusFilter = /** @type {any} */ (
    view.querySelector('[aria-label="Filter by status"]')
  );
  statusFilter.value = 'In-progress';
  statusFilter.dispatchEvent({ type: 'change', target: statusFilter });
  [...view.querySelectorAll('.cora-case-open-btn')]
    .at(-1)
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));

  assert.deepEqual(actions, [
    { type: 'reviewer-table/filter-text-changed', value: 'conduct' },
    { type: 'reviewer-table/status-filter-changed', value: 'In-progress' },
  ]);
  assert.equal(location.hash, '#/case/conduct/beta');
});

test('dashboard pure view renders role-visible reviewer, owner, and allocation panels', () => {
  const ctx = context(
    capabilities({ isReviewer: true, ownedCaseTypes: ['complaints'] })
  );
  ctx.client = null;
  const slice = createRouteSlice({}, ctx);
  const view = dashboardView(slice.initialState, {
    dispatch: () => {},
    context: ctx,
  });

  assert.equal(view.querySelector('h1')?.textContent, 'Outstanding Cases');
  assert.equal(
    view.querySelector('.cora-allocation-btn')?.textContent,
    'Request next Case'
  );
  assert.equal(
    view.querySelector('.cora-owner-summary-heading')?.textContent,
    'Case Type Ownership Summary'
  );
  assert.equal(view.querySelector('cora-allocation'), null);
  assert.equal(view.querySelector('cora-owner-summary'), null);
  assert.match(view.textContent, /No outstanding cases/);
  view
    .querySelector('.cora-allocation-btn')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));

  // Existing DOM-stub debt retained until the shared debt ledger can move.
  assert.ok(/** @type {any} */ (view)._children);
  assert.ok(/** @type {any} */ (view)._children.length >= 1);
  assert.ok(/** @type {any} */ (view)._children[0]);
});

test('dashboard owner summary loads through the route slice and renders from state', async () => {
  const ctx = context(capabilities({ ownedCaseTypes: ['complaints'] }));
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      loadOwnerSummary: async () => [
        {
          caseType: 'complaints',
          outstanding: 2,
          assigned: 3,
          overdue: 1,
          completedToday: 4,
          completedLast7Days: 9,
        },
      ],
    })
  );
  slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => true,
  });
  await Promise.resolve();
  await Promise.resolve();

  const loadedAction = actions.find(
    (action) => action.type === 'owner-summaries/loaded'
  );
  assert.ok(loadedAction);
  const loaded = slice.reducer(slice.initialState, loadedAction);
  const view = dashboardView(/** @type {any} */ (loaded), {
    context: ctx,
    dispatch: () => {},
  });
  assert.match(view.textContent, /complaints/);
  assert.match(view.textContent, /Completed \(last 7 days\)9/);
});

test('dashboard owner summary suppresses a late result after route disposal', async () => {
  const ctx = context(capabilities({ ownedCaseTypes: ['complaints'] }));
  /** @type {(value: any[]) => void} */
  let resolveSummaries = () => {};
  const summaries = new Promise((resolve) => {
    resolveSummaries = resolve;
  });
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      loadOwnerSummary: async () => summaries,
    })
  );
  let active = true;
  const dispose = slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => active,
  });
  // The adapter aborts the lifetime as part of the same disposal.
  dispose();
  active = false;
  resolveSummaries([{ caseType: 'late' }]);
  await summaries;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(
    actions.some((action) => action.type === 'owner-summaries/loaded'),
    false
  );
});

test('dashboard allocation claims a candidate and refreshes reviewer rows through route actions', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  /** @type {any[]} */
  const patches = [];
  ctx.client = /** @type {any} */ ({
    async patchCase(/** @type {any[]} */ ...args) {
      patches.push(args);
      return { ok: true };
    },
  });
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [{ id: 'refreshed', dueDate: '' }],
      loadAllocationAvailability: async () => ({
        candidates: [
          {
            id: 'oldest',
            etag: '"4"',
            _listOptions: { listName: 'Cases-Complaints' },
          },
        ],
        isAtCapacity: false,
      }),
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => true,
  });
  slice.start(tools);
  const view = slice.view(slice.initialState, tools);
  view
    .querySelector('.cora-allocation-btn')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(patches, [
    [
      'oldest',
      { assignedReviewer: 'u1' },
      '"4"',
      { listName: 'Cases-Complaints' },
    ],
  ]);
  assert.ok(
    actions.some(
      (action) =>
        action.type === 'reviewer-cases/loaded' &&
        action.cases[0].id === 'refreshed'
    )
  );
});

test('dashboard allocation retries a stale candidate before claiming the next Case', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  /** @type {string[]} */
  const patches = [];
  ctx.client = /** @type {any} */ ({
    async patchCase(/** @type {string} */ id) {
      patches.push(id);
      return { ok: id === 'available' };
    },
  });
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      loadAllocationAvailability: async () => ({
        candidates: [
          {
            id: 'stale',
            etag: '"1"',
            _listOptions: { listName: 'Cases-Complaints' },
          },
          {
            id: 'available',
            etag: '"2"',
            _listOptions: { listName: 'Cases-Complaints' },
          },
        ],
        isAtCapacity: false,
      }),
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => true,
  });
  slice.start(tools);
  fireEvent(
    getByRole(slice.view(slice.initialState, tools), 'button', {
      name: 'Request next Case',
    }),
    'click'
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(patches, ['stale', 'available']);
  assert.equal(
    actions.some(
      (action) =>
        action.type === 'allocation/availability-changed' && action.isEmpty
    ),
    false
  );
});

test('dashboard allocation exhausts stale candidates and renders the resulting empty state', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  ctx.client = /** @type {any} */ ({
    async patchCase() {
      return { ok: false };
    },
  });
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      loadAllocationAvailability: async () => ({
        candidates: [
          {
            id: 'stale',
            etag: '"1"',
            _listOptions: { listName: 'Cases-Complaints' },
          },
        ],
        isAtCapacity: false,
      }),
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => true,
  });
  slice.start(tools);
  slice
    .view(slice.initialState, tools)
    .querySelector('.cora-allocation-btn')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const exhausted = actions.find(
    (action) => action.type === 'allocation/availability-changed'
  );
  assert.deepEqual(exhausted, {
    type: 'allocation/availability-changed',
    isEmpty: true,
    isAtCapacity: false,
  });
  const state = slice.reducer(slice.initialState, exhausted);
  assert.match(slice.view(state, tools).textContent, /No Cases available/);
});

test('dashboard allocation action is inert before start and after route disposal', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  /** @type {(value: any) => void} */
  let resolveAvailability = () => {};
  const availability = new Promise((resolve) => {
    resolveAvailability = resolve;
  });
  let patches = 0;
  ctx.client = /** @type {any} */ ({
    async patchCase() {
      patches += 1;
      return { ok: true };
    },
  });
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      loadAllocationAvailability: async () => availability,
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => true,
  });

  slice
    .view(slice.initialState, tools)
    .querySelector('.cora-allocation-btn')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  const dispose = slice.start(tools);
  slice
    .view(slice.initialState, tools)
    .querySelector('.cora-allocation-btn')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  dispose();
  resolveAvailability({
    candidates: [
      {
        id: 'late',
        etag: '"1"',
        _listOptions: { listName: 'Cases-Complaints' },
      },
    ],
    isAtCapacity: false,
  });
  await availability;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(patches, 1);
  assert.equal(
    actions.some((action) => action.type === 'allocation/availability-changed'),
    false
  );
});

test('dashboard allocation does not publish exhausted state after route disposal', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  /** @type {(value: any) => void} */
  let resolveAvailability = () => {};
  const availability = new Promise((resolve) => {
    resolveAvailability = resolve;
  });
  ctx.client = /** @type {any} */ ({
    async patchCase() {
      return { ok: false };
    },
  });
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      loadAllocationAvailability: async () => availability,
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => true,
  });
  const dispose = slice.start(tools);
  slice
    .view(slice.initialState, tools)
    .querySelector('.cora-allocation-btn')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  dispose();
  resolveAvailability({
    candidates: [
      {
        id: 'late-stale',
        etag: '"1"',
        _listOptions: { listName: 'Cases-Complaints' },
      },
    ],
    isAtCapacity: false,
  });
  await availability;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(
    actions.some((action) => action.type === 'allocation/availability-changed'),
    false
  );
});

test('dashboard allocation immediately publishes capacity after the claim that reaches the limit', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  let patches = 0;
  ctx.client = /** @type {any} */ ({
    async patchCase() {
      patches += 1;
      return { ok: true };
    },
  });
  let checks = 0;
  /** @type {any[]} */
  const actions = [];
  /** @type {() => void} */
  let markFirstClaimComplete = () => {};
  /** @type {Promise<void>} */
  const firstClaimComplete = new Promise((resolve) => {
    markFirstClaimComplete = () => resolve();
  });
  /** @type {() => void} */
  let markCapacityPublished = () => {};
  /** @type {Promise<void>} */
  const capacityPublished = new Promise((resolve) => {
    markCapacityPublished = () => resolve();
  });
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      async loadAllocationAvailability() {
        checks += 1;
        return checks === 1
          ? {
              candidates: [
                {
                  id: 'third',
                  etag: '"1"',
                  _listOptions: { listName: 'Cases-Complaints' },
                },
              ],
              isAtCapacity: false,
            }
          : { candidates: [], isAtCapacity: true };
      },
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => {
      actions.push(action);
      if (action.type === 'reviewer-cases/loaded' && patches === 1) {
        markFirstClaimComplete();
      }
      if (
        action.type === 'allocation/availability-changed' &&
        action.isAtCapacity === true
      ) {
        markCapacityPublished();
      }
    },
    listen: () => {},
    isActive: () => true,
  });
  slice.start(tools);

  fireEvent(
    getByRole(slice.view(slice.initialState, tools), 'button', {
      name: 'Request next Case',
    }),
    'click'
  );
  await firstClaimComplete;
  await capacityPublished;

  assert.equal(checks, 2);
  assert.equal(patches, 1);
  const capacity = actions.find(
    (action) =>
      action.type === 'allocation/availability-changed' &&
      action.isAtCapacity === true
  );
  assert.deepEqual(capacity, {
    type: 'allocation/availability-changed',
    isEmpty: false,
    isAtCapacity: true,
  });
  const state = slice.reducer(slice.initialState, capacity);
  assert.match(
    slice.view(state, tools).textContent,
    /Maximum active Cases reached/
  );
});

test('dashboard allocation coalesces concurrent requests into one capacity check', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  /** @type {(value: any) => void} */
  let resolveAvailability = () => {};
  const availability = new Promise((resolve) => {
    resolveAvailability = resolve;
  });
  let checks = 0;
  /** @type {() => void} */
  let markPublished = () => {};
  /** @type {Promise<void>} */
  const published = new Promise((resolve) => {
    markPublished = () => resolve();
  });
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      async loadAllocationAvailability() {
        checks += 1;
        return availability;
      },
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch(/** @type {any} */ action) {
      if (action.type === 'allocation/availability-changed') markPublished();
    },
    listen: () => {},
    isActive: () => true,
  });
  slice.start(tools);
  const request = () =>
    fireEvent(
      getByRole(slice.view(slice.initialState, tools), 'button', {
        name: 'Request next Case',
      }),
      'click'
    );

  request();
  request();
  assert.equal(checks, 1);
  resolveAvailability({ candidates: [], isAtCapacity: false });
  await published;
});

test('dashboard reducer stores owner-summary state', () => {
  const slice = createRouteSlice({}, context(capabilities()));
  const withSummaries = slice.reducer(slice.initialState, {
    type: 'owner-summaries/loaded',
    summaries: [{ caseType: 'complaints' }],
  });

  assert.deepEqual(withSummaries.routes.dashboard.ownerSummaries, [
    { caseType: 'complaints' },
  ]);
});

test('dashboard reducer returns the same state for an action no slice handles', () => {
  const slice = createRouteSlice({}, context(capabilities()));

  assert.strictEqual(
    slice.reducer(slice.initialState, { type: 'nothing/here' }),
    slice.initialState
  );
});

test('dashboard reducer keeps chrome by reference across a patch', () => {
  const ctx = context(capabilities());
  const slice = createRouteSlice({}, ctx);
  const next = slice.reducer(slice.initialState, {
    type: 'reviewer-cases/loaded',
    cases: [{ id: 'c1' }],
  });

  assert.strictEqual(next.chrome, slice.initialState.chrome);
  assert.strictEqual(
    next.routes.dashboard.actionCentre,
    slice.initialState.routes.dashboard.actionCentre
  );
});

test('dashboard reducer composes Controls, Action Centre, and Responsible Party transitions', () => {
  const ctx = context(
    capabilities({
      isReviewer: true,
      isAdviser: true,
      isControls: true,
      ownedCaseTypes: ['complaints'],
    })
  );
  const slice = createRouteSlice({}, ctx);
  let state = slice.reducer(slice.initialState, {
    type: 'appeals/loaded',
    cases: [{ id: 'appeal' }],
  });
  state = slice.reducer(state, {
    type: 'appeals-table/sort-requested',
    key: 'raised',
  });
  state = slice.reducer(state, {
    type: 'kpi/tile-toggled',
    role: 'owner',
    key: 'at-risk',
  });
  state = slice.reducer(state, {
    type: 'action-centre/scope-changed',
    value: false,
  });
  assert.deepEqual(state.routes.dashboard.actionCentre.counts, {});
  state = slice.reducer(state, {
    type: 'action-centre/counts-loaded',
    counts: { overdue: 2 },
    peeks: { overdue: null },
    headline: 2,
  });
  const scopedWithStaleCounts = slice.reducer(state, {
    type: 'action-centre/scope-changed',
    value: true,
  });
  const scopedView = dashboardView(scopedWithStaleCounts, {
    context: ctx,
    dispatch: () => {},
  });
  state = slice.reducer(state, {
    type: 'action-centre/group-toggled',
    reasonId: 'overdue',
  });
  state = slice.reducer(state, {
    type: 'action-centre/group-toggled',
    reasonId: 'overdue',
  });
  state = slice.reducer(state, {
    type: 'action-centre/group-toggled',
    reasonId: 'overdue',
  });
  state = slice.reducer(state, {
    type: 'action-centre/page-loaded',
    reasonId: 'overdue',
    skip: 0,
    rows: [{ id: 'first' }],
    exhausted: false,
  });
  state = slice.reducer(state, {
    type: 'action-centre/page-loaded',
    reasonId: 'overdue',
    skip: 1,
    rows: [{ id: 'second' }],
    exhausted: true,
  });
  state = slice.reducer(state, {
    type: 'responsible-party/filter-changed',
    value: 'complaints',
  });
  state = slice.reducer(state, {
    type: 'remediation-table/sort-requested',
    key: 'dueDate',
  });
  state = slice.reducer(state, {
    type: 'unread-table/sort-requested',
    key: 'lastMessage',
  });
  const unchanged = slice.reducer(state, { type: 'ignored' });

  assert.equal(state.routes.dashboard.appealCases.length, 1);
  assert.deepEqual(state.routes.dashboard.appealSort, {
    key: 'raised',
    dir: 'desc',
  });
  assert.equal(
    state.routes.dashboard.expandedKpiTiles.has('owner:at-risk'),
    true
  );
  assert.equal(state.routes.dashboard.actionCentre.needsActionNow, false);
  assert.equal(
    /** @type {any} */ (state.routes.dashboard.actionCentre.pages).overdue
      .length,
    2
  );
  assert.equal(state.routes.dashboard.actionCentre.counts.overdue, 2);
  assert.equal(
    scopedWithStaleCounts.routes.dashboard.actionCentre.counts.overdue,
    2
  );
  assert.equal(scopedWithStaleCounts.routes.dashboard.actionCentre.headline, 2);
  assert.doesNotMatch(
    scopedView.querySelector('.cora-action-centre')?.textContent ?? '',
    /Nothing needs your action right now/
  );
  assert.equal(state.routes.dashboard.responsibleParty.filter, 'complaints');
  assert.equal(
    state.routes.dashboard.responsibleParty.remediationSort?.dir,
    'desc'
  );
  assert.equal(state.routes.dashboard.responsibleParty.messageSort?.dir, 'asc');
  assert.equal(unchanged, state);
});

test('dashboard pure view composes every real panel for a multi-role user', () => {
  const ctx = context(
    capabilities({
      isReviewer: true,
      isAdviser: true,
      isControls: true,
      ownedCaseTypes: ['complaints'],
    })
  );
  ctx.client = null;
  const slice = createRouteSlice({}, ctx);
  const caseRow =
    /** @type {import('../src/sharepoint-client.js').CaseRow} */ ({
      id: 'c1',
      caseType: 'complaints',
      title: 'Case c1',
      status: 'In-progress',
      assignedReviewer: 'u1',
      responsibleParty: 'u1',
      answers: {
        q1: {
          value: 'No',
          remediationActions: [{ id: 'r1', text: 'Fix it', completed: false }],
        },
      },
      conversation: [
        {
          author: 'reviewer',
          timestamp: '2026-06-01T00:00:00Z',
          body: 'Update',
        },
      ],
      notes: '',
      completedAt: null,
      dueDate: '2020-01-01T00:00:00Z',
      overdue: true,
      appeals: [
        {
          id: 'a1',
          appellant: 'owner',
          at: '2026-01-01T00:00:00Z',
          rationale: 'Review',
          state: 'raised',
        },
      ],
      etag: 'e',
    });
  const actionCentre = {
    ...slice.initialState.routes.dashboard.actionCentre,
    counts: {
      ...Object.fromEntries(
        slice.initialState.routes.dashboard.actionCentre.reasons.map(
          (reason) => [reason.id, 1]
        )
      ),
      [slice.initialState.routes.dashboard.actionCentre.reasons[0].id]: 2,
    },
    headline: 1,
    expanded: new Set([
      slice.initialState.routes.dashboard.actionCentre.reasons[0].id,
    ]),
    pages: {
      [slice.initialState.routes.dashboard.actionCentre.reasons[0].id]: [
        caseRow,
      ],
    },
  };
  const state = {
    ...slice.initialState,
    routes: {
      dashboard: {
        ...slice.initialState.routes.dashboard,
        reviewerCases: [
          caseRow,
          { ...caseRow, id: 'c2', title: 'Case c2', overdue: false },
        ],
        appealCases: [caseRow],
        kpiLanes: [
          {
            role: 'reviewer',
            label: 'As Reviewer',
            scopeLabel: 'Complaints',
            isPrimary: true,
            defaultOpen: true,
            totalItems: 1,
            tiles: [
              {
                key: 'overdue',
                label: 'Overdue',
                tone: 'overdue',
                count: 1,
                defaultExpanded: false,
                breakdown: null,
              },
            ],
          },
        ],
        openKpiLanes: new Set(['reviewer']),
        actionCentre,
        responsibleParty: {
          ...slice.initialState.routes.dashboard.responsibleParty,
          cases: [caseRow],
        },
      },
    },
  };
  /** @type {any[]} */
  const actions = [];
  const view = dashboardView(/** @type {any} */ (state), {
    context: ctx,
    dispatch: (action) => actions.push(action),
    actionCentreActions: {
      toggleNeedsAction: (_state, value) => actions.push(['scope', value]),
      toggleGroup: (_state, reason) => actions.push(['group', reason.id]),
      showMore: (_state, reason) => actions.push(['more', reason.id]),
    },
  });

  assert.ok(view.querySelector('.cora-kpi-strip'));
  assert.ok(view.querySelector('.cora-action-centre'));
  assert.ok(view.querySelector('.cora-reviewer-cases'));
  assert.ok(view.querySelector('.cora-rp-remediation'));
  assert.ok(view.querySelector('.cora-controls-appeals'));
  assert.ok(view.querySelector('.cora-owner-summary-heading'));
  assert.ok(view.querySelector('.cora-allocation-btn'));
  assert.equal(view.querySelector('cora-owner-summary'), null);
  assert.equal(view.querySelector('cora-allocation'), null);

  [...view.querySelectorAll('button')].forEach((button) =>
    button.dispatchEvent(/** @type {any} */ ({ type: 'click' }))
  );
  assert.ok(actions.length > 0);
  assert.equal(location.hash, '#/case/complaints/c1');

  const withoutController = dashboardView(/** @type {any} */ (state), {
    context: ctx,
    dispatch: () => {},
  });
  [
    ...(withoutController
      .querySelector('.cora-action-centre')
      ?.querySelectorAll('button') ?? []),
  ].forEach((button) =>
    button.dispatchEvent(/** @type {any} */ ({ type: 'click' }))
  );
});

test('dashboard Action Centre controller reloads scope, groups, and pages through store actions', async () => {
  const ctx = context(
    capabilities({
      isReviewer: true,
      isAdviser: true,
      isControls: true,
      ownedCaseTypes: ['complaints'],
    })
  );
  ctx.client = { countCases() {} };
  let countLoads = 0;
  let pageLoads = 0;
  /** @type {() => void} */
  let markInitialPage = () => {};
  /** @type {Promise<void>} */
  const initialPage = new Promise((resolve) => {
    markInitialPage = resolve;
  });
  /** @type {() => void} */
  let markScopePage = () => {};
  /** @type {Promise<void>} */
  const scopePage = new Promise((resolve) => {
    markScopePage = resolve;
  });
  const slice = createRouteSlice({}, ctx, {
    listAcrossSources: async () => [],
    loadAppeals: async () => [],
    loadKpis: async () => [],
    loadOwnerSummary: async () => [],
    loadActionCounts: async ({ reasons }) => {
      countLoads += 1;
      return {
        counts: Object.fromEntries(reasons.map((reason) => [reason.id, 2])),
        peeks: Object.fromEntries(reasons.map((reason) => [reason.id, null])),
        headline: 2,
      };
    },
    loadActionPage: async ({ reason, skip }) => {
      pageLoads += 1;
      return {
        rows: [
          {
            id: `${reason.id}-${skip}`,
            caseType: 'complaints',
            title: `${reason.id}-${skip}`,
            status: 'In-progress',
            assignedReviewer: 'u1',
            responsibleParty: 'rp',
            answers: {},
            conversation: [],
            notes: '',
            completedAt: null,
            dueDate: '2020-01-01T00:00:00Z',
            overdue: true,
            etag: 'e',
          },
        ],
        exhausted: false,
      };
    },
  });
  let state = slice.initialState;
  const dispatch = (/** @type {any} */ action) => {
    state = slice.reducer(state, action);
    if (action.type === 'action-centre/page-loaded') {
      if (pageLoads === 1) markInitialPage();
      if (pageLoads === 2) markScopePage();
    }
    return state;
  };
  const dispose = slice.start({
    context: ctx,
    params: {},
    dispatch,
    listen: (
      /** @type {any} */ target,
      /** @type {string} */ type,
      /** @type {any} */ listener
    ) => target.addEventListener(type, listener),
    isActive: () => true,
  });
  await initialPage;

  let view = slice.view(state, { context: ctx, dispatch });
  const all = [...view.querySelectorAll('.cora-ac-toggle-btn')].find(
    (button) => button.textContent === 'All'
  );
  all?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  await scopePage;
  assert.equal(state.routes.dashboard.actionCentre.needsActionNow, false);

  view = slice.view(state, { context: ctx, dispatch });
  view
    .querySelector('.cora-ac-group-header')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  view = slice.view(state, { context: ctx, dispatch });
  view
    .querySelector('.cora-ac-group-header')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  await Promise.resolve();

  view = slice.view(state, { context: ctx, dispatch });
  view
    .querySelector('.cora-ac-more')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  await Promise.resolve();

  const needs = [...view.querySelectorAll('.cora-ac-toggle-btn')].find(
    (button) => button.textContent === 'Needs action now'
  );
  needs?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  needs?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));
  await Promise.resolve();

  assert.ok(countLoads >= 2);
  assert.ok(pageLoads >= 3);
  dispose?.();
});

test('#516 dashboard view: clicking a reviewer column header dispatches the reviewer table sort action', () => {
  const ctx = context(capabilities({ isReviewer: true }));
  const slice = createRouteSlice({}, ctx);
  const loaded = slice.reducer(slice.initialState, {
    type: 'reviewer-cases/loaded',
    cases: [
      {
        id: 'alpha',
        title: 'Alpha case',
        caseType: 'complaints',
        status: 'In-progress',
        relatedDate: '2026-01-01',
        dueDate: '2026-01-10',
        overdue: false,
      },
    ],
  });
  /** @type {any[]} */
  const actions = [];
  const view = dashboardView(/** @type {any} */ (loaded), {
    context: ctx,
    dispatch: (/** @type {any} */ action) => actions.push(action),
  });

  fireEvent(getByRole(view, 'button', { name: 'Related Date' }), 'click');
  assert.deepEqual(actions, [
    { type: 'reviewer-table/sort-requested', key: 'relatedDate' },
  ]);
});

test('#516 dashboard view: clicking an appeals column header dispatches the appeals table sort action', () => {
  const ctx = context(capabilities({ isControls: true }));
  const slice = createRouteSlice({}, ctx);
  const loaded = slice.reducer(slice.initialState, {
    type: 'appeals/loaded',
    cases: [
      {
        id: 'appeal',
        title: 'Appealed case',
        caseType: 'complaints',
        responsibleParty: 'rp-1',
        appeal: { raisedAt: '2026-01-01T00:00:00Z', raisedBy: 'rp-1' },
      },
    ],
  });
  /** @type {any[]} */
  const actions = [];
  const view = dashboardView(/** @type {any} */ (loaded), {
    context: ctx,
    dispatch: (/** @type {any} */ action) => actions.push(action),
  });

  fireEvent(getByRole(view, 'button', { name: 'Raised' }), 'click');
  assert.deepEqual(actions, [
    { type: 'appeals-table/sort-requested', key: 'raised' },
  ]);
});
