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
      // Overdue, so the row class this table renders is pinned below (#542).
      overdue: true,
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
  // #542 centralised this table's `rowClass` on the shared
  // `overdueCaseRowClass`, so pin what it renders here too — otherwise only the
  // Journey Cases test fails when the shared helper is broken, and the
  // reviewer worklist loses its overdue styling silently. The Dashboard is the
  // one table that derives `overdue` itself — the load effect stamps
  // `isOverdue(row)` onto each row before dispatching `reviewer-cases/loaded` —
  // so the flag arrives on the action, as it does here, and the reducer and
  // view take it as given.
  assert.deepEqual(
    [
      ...(unfiltered
        .querySelector('.cora-reviewer-cases')
        ?.querySelector('tbody')
        ?.querySelectorAll('tr') ?? []),
    ].map((tableRow) => tableRow.className),
    ['cora-case-row cora-case-row--overdue', 'cora-case-row', 'cora-case-row']
  );
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
  // This table opens the Case, so `Open ${reference}` is the right name and
  // stays the default (#541).
  const open = getByRole(view, 'button', { name: 'Open Beta case' });
  assert.equal(open.className, 'cora-case-open-btn');
  open.dispatchEvent(/** @type {any} */ ({ type: 'click' }));

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
    key: 'remediationDueDate',
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
          remediationActions: [{ id: 'r1', text: 'Fix it' }],
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
    fireEvent(button, 'click', { bubbles: false })
  );
  // Not `actions.length > 0`: that aggregate stayed true while individual
  // Action Centre seams were no-ops (#544). Name every controller callback the
  // panel is supposed to reach, in document order.
  const reasonIds =
    slice.initialState.routes.dashboard.actionCentre.reasons.map(
      (/** @type {any} */ reason) => reason.id
    );
  assert.deepEqual(
    actions.filter((action) => Array.isArray(action)),
    [
      ['scope', true],
      ['scope', false],
      ['group', reasonIds[0]],
      // Only the first reason is expanded, so only it renders rows and a
      // Show more control.
      ['more', reasonIds[0]],
      ...reasonIds.slice(1).map((/** @type {string} */ id) => ['group', id]),
    ]
  );
  assert.ok(
    actions.some((action) => !Array.isArray(action)),
    'and the store-driven panels dispatched too'
  );
  assert.equal(location.hash, '#/case/complaints/c1');

  const withoutController = dashboardView(/** @type {any} */ (state), {
    context: ctx,
    dispatch: () => {},
  });
  [
    ...(withoutController
      .querySelector('.cora-action-centre')
      ?.querySelectorAll('button') ?? []),
  ].forEach((button) => fireEvent(button, 'click', { bubbles: false }));
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

test('#542 dashboard appeals: Reference and Case Type sort for real — click, dispatch, sorted render', () => {
  const ctx = context(capabilities({ isControls: true }));
  const slice = createRouteSlice({}, ctx);
  // The Appeals table's deliberate default, unmoved by gaining two sortable
  // columns (#516).
  assert.deepEqual(slice.initialState.routes.dashboard.appealSort, {
    key: 'raised',
    dir: 'asc',
  });

  /** @param {string} id @param {string} caseType */
  const appealRow = (id, caseType) => ({
    id,
    title: id,
    caseType,
    responsibleParty: 'rp-1',
    appeals: [
      {
        id: `appeal-${id}`,
        appellant: 'owner',
        at: '2026-01-01T00:00:00Z',
        state: 'raised',
        rationale: 'why',
      },
    ],
  });
  const loaded = slice.reducer(slice.initialState, {
    type: 'appeals/loaded',
    cases: [appealRow('Zed case', 'sales'), appealRow('Alpha case', 'banking')],
  });

  /** @param {any} state @param {any[]} actions */
  const render = (state, actions) =>
    dashboardView(/** @type {any} */ (state), {
      context: ctx,
      dispatch: (/** @type {any} */ action) => actions.push(action),
    });
  // Scoped to the Appeals panel: Controls happens to render one table today,
  // so an unscoped 'tbody' would read the right rows by luck.
  /** @param {any} view */
  const references = (view) =>
    [
      ...(view
        .querySelector('.cora-controls-appeals')
        ?.querySelector('tbody')
        ?.querySelectorAll('tr') ?? []),
    ].map(
      (/** @type {any} */ row) => row.querySelectorAll('td')[0].textContent
    );

  for (const [column, key, expected] of [
    ['Reference', 'reference', ['Alpha case', 'Zed case']],
    ['Case Type', 'caseType', ['Alpha case', 'Zed case']],
  ]) {
    /** @type {any[]} */
    const actions = [];
    fireEvent(
      getByRole(render(loaded, actions), 'button', {
        name: /** @type {string} */ (column),
      }),
      'click'
    );
    assert.deepEqual(actions, [{ type: 'appeals-table/sort-requested', key }]);

    const sorted = slice.reducer(loaded, actions[0]);
    assert.deepEqual(sorted.routes.dashboard.appealSort, { key, dir: 'asc' });
    assert.deepEqual(references(render(sorted, [])), expected);
  }
});

test('dashboard slice: navigating away aborts the fan-out reads with no error UI (#545)', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  const controller = new AbortController();
  let aborted = false;
  // A request still in flight: it settles only when the caller aborts.
  ctx.client = {
    listCases: (/** @type {any} */ _filter, /** @type {any} */ opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          aborted = true;
          reject(opts.signal.reason);
        });
      }),
  };
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({ loadKpis: async () => [] })
  );

  slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => !controller.signal.aborted,
    signal: controller.signal,
  });
  controller.abort();

  // An unhandled AbortError rejection fails the run under `node --test`, so
  // draining the effects here also proves each one handles its own abort.
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.equal(aborted, true, 'the in-flight fan-out read was cancelled');
  assert.equal(
    actions.some((action) => action.type === 'reviewer-cases/loaded'),
    false,
    'the aborted fan-out dispatches nothing'
  );
  assert.deepEqual(ctx.chrome.toasts, [], 'an abort raises no toast');
});

test('dashboard Action Centre: an aborted count or page load dispatches nothing (#545)', async () => {
  const ctx = context(capabilities({ isReviewer: true, isAdviser: true }));
  ctx.client = { countCases() {} };
  const controller = new AbortController();
  /** @param {AbortSignal} signal */
  const abortedRead = (signal) =>
    Promise.reject(
      signal.reason ??
        Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      listAcrossSources: async () => [],
      loadAppeals: async () => [],
      loadKpis: async () => [],
      loadOwnerSummary: async () => [],
      loadActionCounts: () => abortedRead(controller.signal),
      loadActionPage: () => abortedRead(controller.signal),
    })
  );
  /** @type {any[]} */
  const actions = [];
  controller.abort();

  slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => !controller.signal.aborted,
    signal: controller.signal,
  });

  // An unhandled AbortError rejection fails the run under `node --test`.
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.equal(
    actions.some((action) =>
      String(action.type).startsWith('action-centre/counts')
    ),
    false
  );
  assert.equal(
    actions.some((action) => action.type === 'action-centre/page-loaded'),
    false
  );
  assert.deepEqual(ctx.chrome.toasts, [], 'an abort raises no toast');
});

test('dashboard Action Centre: an aborted reason-page read renders no rows and no error (#545)', async () => {
  const ctx = context(capabilities({ isReviewer: true, isAdviser: true }));
  ctx.client = { countCases() {} };
  const abortError = Object.assign(new Error('aborted'), {
    name: 'AbortError',
  });
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      listAcrossSources: async () => [],
      loadAppeals: async () => [],
      loadKpis: async () => [],
      loadOwnerSummary: async () => [],
      loadActionCounts: async (/** @type {any} */ { reasons }) => ({
        counts: Object.fromEntries(
          reasons.map((/** @type {any} */ reason) => [reason.id, 1])
        ),
        peeks: Object.fromEntries(
          reasons.map((/** @type {any} */ reason) => [reason.id, null])
        ),
        headline: 1,
      }),
      // The user navigated away between the counts and the first page.
      loadActionPage: () => Promise.reject(abortError),
    })
  );
  /** @type {any[]} */
  const actions = [];

  slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    listen: () => {},
    isActive: () => true,
    signal: new AbortController().signal,
  });

  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.equal(
    actions.some((action) => action.type === 'action-centre/counts-loaded'),
    true,
    'the counts that did land are still shown'
  );
  assert.equal(
    actions.some((action) => action.type === 'action-centre/page-loaded'),
    false,
    'the aborted page read dispatches nothing'
  );
  assert.deepEqual(ctx.chrome.toasts, [], 'an abort raises no toast');
});

test('dashboard slice: a client-less mount with a mount signal renders an empty dashboard rather than failing the route (#545)', async () => {
  const ctx = context(capabilities({ isReviewer: true, isControls: true }));
  ctx.client = null;
  const controller = new AbortController();
  /** @type {any[]} */
  const actions = [];
  const slice = createRouteSlice({}, ctx);

  // Boot can hand a route a context with no client at all. Binding the mount
  // signal must not be what decides whether the route survives that.
  assert.doesNotThrow(() =>
    slice.start({
      context: ctx,
      params: {},
      dispatch: (/** @type {any} */ action) => actions.push(action),
      listen: () => {},
      isActive: () => true,
      signal: controller.signal,
    })
  );

  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.deepEqual(actions, [], 'no client means no loads and no failures');
  assert.deepEqual(ctx.chrome.toasts, []);
});

/*
 * #544 audit — seams deliberately left uncovered here, and why. (The audit's
 * page-wiring assertions live in this file, cora-case-review-slice.test.js,
 * cora-conversation-view.test.js, cora-responsible-party-dashboard-loading.test.js
 * and question-bank-slice.test.js.)
 *
 * - Table sort headers on the Dashboard reviewer + appeals tables, My Team, and
 *   the Responsible Party remediation + unread tables: already asserted
 *   click→dispatch by #516 and #542. Covered elsewhere, not gaps.
 * - The question-bank sub-editors (options-editor, wording-editor, showwhen-*,
 *   question-labels): every card edit reaches the store through the one
 *   `BankList` dispatch prop, which the `#544 bank editor: the BankList dispatch
 *   carries a card edit` test asserts. Covering each sub-editor separately would
 *   re-assert the same seam.
 * - Case Review Section panels (summary/outcome/notes/appeal views): asserted
 *   through the shipped route render in cora-case-review-slice.test.js rather
 *   than by stub handlers, so the page wiring is already in the assertion path.
 * - `dashboard/controls-view.js`'s row links and `action-centre-view.js`'s row
 *   anchors: plain `href` navigation with no page-supplied callback, so there is
 *   no wiring seam to mis-wire.
 */

test('#544 dashboard KPI strip: a lane header and a tile dispatch the disclosure actions the reducer owns', () => {
  const ctx = context(capabilities({ isReviewer: true }));
  const slice = createRouteSlice({}, ctx);
  const loaded = slice.reducer(slice.initialState, {
    type: 'kpis/loaded',
    lanes: [
      {
        role: 'reviewer',
        label: 'As Reviewer',
        scopeLabel: 'Complaints',
        isPrimary: true,
        defaultOpen: false,
        totalItems: 2,
        tiles: [
          {
            key: 'overdue',
            label: 'Overdue',
            tone: 'overdue',
            count: 2,
            defaultExpanded: false,
            breakdown: {
              axis: 'caseType',
              rows: [{ label: 'Complaints', count: 2 }],
            },
          },
        ],
      },
    ],
  });
  /** @param {any} state @param {any[]} actions */
  const render = (state, actions) =>
    dashboardView(/** @type {any} */ (state), {
      context: ctx,
      dispatch: (/** @type {any} */ action) => actions.push(action),
    });
  /** @param {any} view @param {string} selector */
  const inStrip = (view, selector) =>
    view.querySelector('.cora-kpi-strip')?.querySelector(selector);

  // The lane starts closed, so its tiles are not rendered at all: the header
  // click is the only way a Reviewer reaches the counts.
  /** @type {any[]} */
  const laneActions = [];
  const closed = render(loaded, laneActions);
  assert.equal(inStrip(closed, '.cora-kpi-tile'), null);
  fireEvent(inStrip(closed, '.cora-kpi-lane__header'), 'click');
  assert.deepEqual(laneActions, [
    { type: 'kpi/lane-toggled', role: 'reviewer' },
  ]);

  const open = slice.reducer(loaded, laneActions[0]);
  /** @type {any[]} */
  const tileActions = [];
  const openView = render(open, tileActions);
  assert.equal(
    inStrip(openView, '.cora-kpi-tile')?.getAttribute('aria-expanded'),
    'false'
  );
  fireEvent(inStrip(openView, '.cora-kpi-tile'), 'click');
  assert.deepEqual(tileActions, [
    { type: 'kpi/tile-toggled', role: 'reviewer', key: 'overdue' },
  ]);

  const expanded = slice.reducer(open, tileActions[0]);
  const expandedView = render(expanded, []);
  assert.equal(
    inStrip(expandedView, '.cora-kpi-tile')?.getAttribute('aria-expanded'),
    'true'
  );
  assert.equal(inStrip(expandedView, '.cora-kpi-row__count')?.textContent, '2');
});

test('#544 dashboard Action Centre: its own Open button navigates to the Case', () => {
  // Deliberately not a Reviewer: the reviewer worklist has an Open button too,
  // and this assertion must fail when *this* panel stops navigating.
  const ctx = context(capabilities({ isControls: true }));
  const slice = createRouteSlice({}, ctx);
  const route = slice.initialState.routes.dashboard;
  const [reason] = route.actionCentre.reasons;
  const state = {
    ...slice.initialState,
    routes: {
      dashboard: {
        ...route,
        actionCentre: {
          ...route.actionCentre,
          counts: { [reason.id]: 1 },
          expanded: new Set([reason.id]),
          pages: {
            [reason.id]: [
              {
                id: 'c7',
                caseType: 'complaints',
                title: 'Appealed case',
                status: 'Completed',
              },
            ],
          },
        },
      },
    },
  };
  const view = dashboardView(/** @type {any} */ (state), {
    context: ctx,
    dispatch: () => {},
  });

  location.hash = '';
  const open = [
    ...(view.querySelector('.cora-action-centre')?.querySelectorAll('button') ??
      []),
  ].find(
    (/** @type {any} */ button) =>
      button.getAttribute('aria-label') === 'Open Appealed case'
  );
  fireEvent(open, 'click');
  assert.equal(location.hash, '#/case/complaints/c7');
});

test('#544 dashboard Action Centre: the group header and Show more reach the panel’s own controller', () => {
  // `onToggleGroup` and `onShowMore` are the last two Action Centre seams the
  // page owns. Stubbing either to a no-op used to leave the suite green while
  // the header stopped expanding and pagination died silently.
  const ctx = context(capabilities({ isControls: true }));
  const slice = createRouteSlice({}, ctx);
  const route = slice.initialState.routes.dashboard;
  const [reason] = route.actionCentre.reasons;
  const actionCentre = {
    ...route.actionCentre,
    // Five cases behind one loaded row, so the Show more control renders.
    counts: { [reason.id]: 5 },
    expanded: new Set([reason.id]),
    pages: {
      [reason.id]: [
        {
          id: 'c7',
          caseType: 'complaints',
          title: 'Appealed case',
          status: 'Completed',
        },
      ],
    },
  };
  /** @type {any[]} */
  const calls = [];
  const view = dashboardView(
    /** @type {any} */ ({
      ...slice.initialState,
      routes: { dashboard: { ...route, actionCentre } },
    }),
    {
      context: ctx,
      dispatch: () => {},
      actionCentreActions: {
        toggleNeedsAction: (/** @type {any} */ panel, value) =>
          calls.push(['scope', panel === actionCentre, value]),
        toggleGroup: (/** @type {any} */ panel, /** @type {any} */ target) =>
          calls.push(['group', panel === actionCentre, target.id]),
        showMore: (/** @type {any} */ panel, /** @type {any} */ target) =>
          calls.push(['more', panel === actionCentre, target.id]),
      },
    }
  );
  const group = view
    .querySelector('.cora-action-centre')
    ?.querySelector(`[data-reason="${reason.id}"]`);
  assert.ok(group, 'the reason group is rendered');

  fireEvent(group.querySelector('.cora-ac-group-header'), 'click');
  assert.deepEqual(calls, [['group', true, reason.id]]);

  fireEvent(group.querySelector('.cora-ac-more'), 'click');
  assert.deepEqual(calls, [
    ['group', true, reason.id],
    ['more', true, reason.id],
  ]);
});

test('#544 dashboard Responsible Party panel: Open conversation navigates to the Conversation route', () => {
  // The embedded panel is the only one that opts into navigation; #/my-cases
  // deliberately keeps the historic no-navigation Open (see the slice).
  const ctx = context(capabilities({ isAdviser: true }));
  const slice = createRouteSlice({}, ctx);
  const route = slice.initialState.routes.dashboard;
  const unread = {
    id: 'c4',
    caseType: 'complaints',
    title: 'Unread case',
    status: 'Actions In Progress',
    assignedReviewer: 'reviewer',
    responsibleParty: 'u1',
    remediationDueDate: '2026-01-01T00:00:00Z',
    answers: {
      q1: { value: 'No', remediationActions: [{ id: 'a1', text: 'Fix' }] },
    },
    conversation: [
      { author: 'reviewer', timestamp: '2026-02-01T00:00:00Z', body: 'hi' },
    ],
    notes: '',
    completedAt: null,
    etag: 'e',
  };
  const view = dashboardView(
    /** @type {any} */ ({
      ...slice.initialState,
      routes: {
        dashboard: {
          ...route,
          responsibleParty: { ...route.responsibleParty, cases: [unread] },
        },
      },
    }),
    { context: ctx, dispatch: () => {} }
  );

  location.hash = '';
  fireEvent(
    getByRole(view, 'button', { name: 'Open conversation for Unread case' }),
    'click'
  );
  assert.equal(location.hash, '#/conversation/complaints/c4');
});
