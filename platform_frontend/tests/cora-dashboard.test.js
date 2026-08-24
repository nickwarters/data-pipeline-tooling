// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole, tableHeaders } from './helpers/semantic-dom.js';
import {
  makeCaseRow,
  makeChrome,
  makePermissions,
} from './helpers/fixtures.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { createRouteSlice, dashboardView } =
  await import('../src/pages/cora-dashboard.js');
const { isOverdue } = await import('../src/evaluators/overdue-evaluator.js');
const { CASE_STATUS } = await import('../src/lib/case-statuses.js');

// Each panel is gated on one capability, so the baseline holds none and every
// test names the roles whose panels it is about.
/** @param {Partial<import('../src/services/permissions.js').Capabilities>} [overrides] */
function capabilities(overrides = {}) {
  return makePermissions({ isReviewer: false, ...overrides });
}

/** @param {any} permissions */
function context(permissions) {
  return /** @type {any} */ ({
    client: {},
    chrome: makeChrome({
      currentUser: { id: 'u1', displayName: 'User' },
      permissions,
    }),
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
      },
    ],
    appEl: document.createElement('main'),
  });
}

/**
 * A claimable Case as the allocation claim's own re-read returns it: still
 * sitting in the pot, still unassigned, and carrying the ETag a single-item
 * read supplies. Only that read produces one, so this is what every allocation
 * stub must answer with for the claim to get as far as its PATCH.
 *
 * @param {string} id
 * @param {string} etag
 */
function claimableRow(id, etag) {
  return { id, assignedReviewer: '', status: CASE_STATUS.TO_ALLOCATE, etag };
}

/**
 * Drain microtasks until the allocation flow reaches the state under assertion;
 * the button discards the claim's promise, so there is nothing to await. A
 * predicate that never holds drains to the cap and fails on the assertion after
 * it rather than hanging.
 *
 * @param {() => boolean} reached
 */
async function settleAllocation(reached) {
  for (let turn = 0; turn < 500 && !reached(); turn += 1) {
    await Promise.resolve();
  }
}

/** @returns {{ promise: Promise<void>, resolve: () => void }} */
function deferred() {
  /** @type {() => void} */
  let resolvePromise = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((resolve) => {
    resolvePromise = () => resolve();
  });
  return { promise, resolve: resolvePromise };
}

/**
 * One claimable candidate, claimed at a fixed instant so a test can assert the
 * stamped review due date literally.
 *
 * @param {{
 *   resolveManagers?: (accountNames: string[]) => Promise<any>,
 *   listName?: string,
 *   reviewSlaWorkingDays?: number,
 *   nowIso?: string,
 * }} [options]
 * @returns {Promise<{ patches: any[], managerLookups: number }>}
 */
async function runSingleCandidateAllocation({
  resolveManagers = async () => ({ u1: 'manager-1' }),
  listName = 'Cases-Complaints',
  reviewSlaWorkingDays,
  nowIso = '2026-08-14T09:00:00.000Z',
} = {}) {
  const ctx = context(capabilities({ isReviewer: true }));
  if (reviewSlaWorkingDays !== undefined) {
    ctx.caseSources[0].reviewSlaWorkingDays = reviewSlaWorkingDays;
  }
  /** @type {any[]} */
  const patches = [];
  let managerLookups = 0;
  ctx.client = /** @type {any} */ ({
    async resolveManagers(/** @type {string[]} */ accountNames) {
      managerLookups += 1;
      return resolveManagers(accountNames);
    },
    async getCase(/** @type {string} */ id) {
      return claimableRow(id, '"fresh-candidate"');
    },
    async patchCase(/** @type {any[]} */ ...args) {
      patches.push(args);
      return { ok: true, status: 200 };
    },
  });
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      loadAllocationAvailability: async () => ({
        candidates: [
          {
            id: 'candidate',
            assignedReviewerManager: 'stale-manager',
            etag: '"1"',
            _listOptions: { listName },
          },
        ],
        isAtCapacity: false,
      }),
      now: () => new Date(nowIso),
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: () => {},
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
  await settleAllocation(() => patches.length > 0);
  return { patches, managerLookups };
}

// Appeals are switched off in this build, so the Controls appeals fan-out does
// not go out and no `appeals/loaded` action is dispatched — asserted below by
// the action list, and directly in `appeals-feature-switch.test.js`. When the
// switch goes, restore `appeals/loaded` to the expected list, take the barrier
// back to three actions, and put "and Controls appeals" back in this name.
test('dashboard slice: effects load reviewer rows and KPI lanes through actions', async () => {
  const caps = capabilities({ isReviewer: true, isControls: true });
  const ctx = context(caps);
  // Overdue is derived from the status as well as the date, so the row carries
  // the status a Case still under review has.
  const reviewer = [
    {
      id: 'reviewer-case',
      status: 'In-progress',
      dueDate: '2020-01-01T00:00:00Z',
    },
  ];
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
        // A real client derives `overdue` on every Case read, so the fake does
        // too — the dashboard takes the flag as given rather than re-deriving.
        return /** @type {any} */ (
          reviewer.map((row) => ({
            ...row,
            overdue: isOverdue(/** @type {any} */ (row)),
          }))
        );
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
      if (actions.length === 2) markLoaded();
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
      // Overdue, so the row class this table renders is pinned below.
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
  // This table's `rowClass` is centralised on the shared
  // `overdueCaseRowClass`, so pin what it renders here too — otherwise only the
  // Journey Cases test fails when the shared helper is broken, and the
  // reviewer worklist loses its overdue styling silently. The flag itself
  // arrives already derived on the rows the client returned, as it does here,
  // and the reducer and view take it as given.
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
    ['Reference', 'none', true],
    ['Case Type', 'none', true],
    ['Related Date', 'none', true],
    ['Due Date', 'none', true],
    ['Status', 'none', true],
    ['Assigned', 'none', true],
    ['Responsible Party', 'none', true],
    ['Actions', 'none', false],
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
    tableHeaders(sortedByReference).map((header) => header[1]),
    ['ascending', 'none', 'none', 'none', 'none', 'none', 'none', 'none']
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
  assert.equal(view.querySelectorAll('th').length, 8);
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
  // stays the default.
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
    async getCase(/** @type {string} */ id) {
      return claimableRow(id, '"re-read-8"');
    },
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
      now: () => new Date('2026-08-14T09:00:00.000Z'),
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
  // The mount already loaded the reviewer's rows once, so the claim's own
  // refresh is the second load — waiting on the first would clear the barrier
  // before the claim had run at all.
  await settleAllocation(
    () =>
      actions.filter((action) => action.type === 'reviewer-cases/loaded')
        .length >= 2
  );

  assert.deepEqual(patches, [
    [
      'oldest',
      {
        status: CASE_STATUS.IN_PROGRESS,
        assignedReviewer: 'u1',
        assignedReviewerManager: null,
        dueDate: '2026-08-21',
      },
      '"re-read-8"',
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

test('dashboard allocation claims with the etag from a re-read, not the empty etag a list row carries', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  // The shape a live collection read hands back: the client asks SharePoint for
  // JSON without metadata annotations, so no listed row carries an ETag at all.
  const listedRow = {
    id: 'oldest',
    assignedReviewer: '',
    status: CASE_STATUS.TO_ALLOCATE,
    etag: '',
  };
  /** @type {any[]} */
  const patches = [];
  /** @type {any[]} */
  const reads = [];
  ctx.client = /** @type {any} */ ({
    countCases: async () => 0,
    listCases: async () => [listedRow],
    async getCase(/** @type {string} */ id, /** @type {any} */ opts) {
      reads.push([id, opts]);
      return { ...listedRow, etag: '"7"' };
    },
    async patchCase(/** @type {any[]} */ ...args) {
      patches.push(args);
      return { ok: true, status: 200 };
    },
    resolveManagers: async () => ({ u1: null }),
  });
  // The real availability loader runs here on purpose: the empty ETag is
  // produced by the listing path itself, so a stubbed loader would hide it.
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: () => {},
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
  await settleAllocation(() => patches.length > 0);

  assert.deepEqual(reads, [['oldest', { listName: 'Cases-Complaints' }]]);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][2], '"7"');
  assert.notEqual(patches[0][2], '');
});

test('dashboard allocation skips a candidate another Reviewer claimed between the list read and the claim', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  /** @type {any[]} */
  const patches = [];
  ctx.client = /** @type {any} */ ({
    async getCase(/** @type {string} */ id) {
      return id === 'taken'
        ? {
            id,
            assignedReviewer: 'someone-else',
            status: CASE_STATUS.IN_PROGRESS,
            etag: '"8"',
          }
        : claimableRow(id, '"9"');
    },
    async patchCase(/** @type {any[]} */ ...args) {
      patches.push(args);
      return { ok: true, status: 200 };
    },
  });
  const candidate = (/** @type {string} */ id) => ({
    id,
    etag: '',
    _listOptions: { listName: 'Cases-Complaints' },
  });
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      loadAllocationAvailability: async () => ({
        candidates: [candidate('taken'), candidate('free')],
        isAtCapacity: false,
      }),
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: () => {},
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
  await settleAllocation(() => patches.length > 0);

  assert.equal(patches.length, 1);
  assert.equal(patches[0][0], 'free');
  assert.equal(patches[0][2], '"9"');
});

test('dashboard allocation skips a candidate whose re-read shows it deleted, no longer under review, or unversioned', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  let patches = 0;
  ctx.client = /** @type {any} */ ({
    async getCase(/** @type {string} */ id) {
      if (id === 'deleted') return null;
      if (id === 'finished') {
        return {
          id,
          assignedReviewer: '',
          status: CASE_STATUS.COMPLETED,
          etag: '"5"',
        };
      }
      return claimableRow(id, '');
    },
    async patchCase() {
      patches += 1;
      return { ok: true, status: 200 };
    },
  });
  const candidate = (/** @type {string} */ id) => ({
    id,
    etag: '',
    _listOptions: { listName: 'Cases-Complaints' },
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
          candidate('deleted'),
          candidate('finished'),
          candidate('unversioned'),
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
  await settleAllocation(() =>
    actions.some((action) => action.type === 'allocation/availability-changed')
  );

  assert.equal(patches, 0);
  assert.ok(
    actions.some(
      (action) =>
        action.type === 'allocation/availability-changed' && action.isEmpty
    )
  );
});

test('dashboard allocation continues after a candidate re-read rejects', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  const firstReadError = new Error('first candidate read failed');
  const secondReadComplete = deferred();
  const patchComplete = deferred();
  /** @type {string[]} */
  const reads = [];
  /** @type {any[]} */
  const patches = [];
  let availabilityChecks = 0;
  ctx.client = /** @type {any} */ ({
    async getCase(/** @type {string} */ id) {
      reads.push(id);
      if (id === 'first') throw firstReadError;
      secondReadComplete.resolve();
      return claimableRow(id, '"fresh-second"');
    },
    async patchCase(/** @type {any[]} */ ...args) {
      patches.push(args);
      patchComplete.resolve();
      return { ok: true, status: 200 };
    },
  });
  const candidate = (/** @type {string} */ id) => ({
    id,
    etag: '"listed"',
    _listOptions: { listName: 'Cases-Complaints' },
  });
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      loadAllocationAvailability: async () =>
        availabilityChecks++ === 0
          ? {
              candidates: [candidate('first'), candidate('second')],
              isAtCapacity: false,
            }
          : { candidates: [], isAtCapacity: false },
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: () => {},
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
  await secondReadComplete.promise;
  await patchComplete.promise;

  assert.deepEqual(reads, ['first', 'second']);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][0], 'second');
  assert.equal(patches[0][2], '"fresh-second"');
});

test('dashboard allocation surfaces an all-candidate read failure without publishing empty availability', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  const firstReadError = new Error('first candidate read failed');
  const secondReadError = new Error('second candidate read failed');
  const readsComplete = deferred();
  const errorLogged = deferred();
  /** @type {string[]} */
  const reads = [];
  /** @type {any[]} */
  const actions = [];
  let patchCalls = 0;
  /** @type {any[][]} */
  const errorCalls = [];
  /** @type {unknown[]} */
  const unhandled = [];
  const originalConsoleError = console.error;
  const onUnhandledRejection = (/** @type {unknown} */ reason) => {
    unhandled.push(reason);
  };
  console.error = (/** @type {any[]} */ ...args) => {
    errorCalls.push(args);
    errorLogged.resolve();
  };
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    ctx.client = /** @type {any} */ ({
      async getCase(/** @type {string} */ id) {
        reads.push(id);
        if (reads.length === 2) readsComplete.resolve();
        throw id === 'first' ? firstReadError : secondReadError;
      },
      async patchCase() {
        patchCalls += 1;
        return { ok: false, status: 500 };
      },
    });
    const slice = createRouteSlice(
      {},
      ctx,
      /** @type {any} */ ({
        loadKpis: async () => [],
        listAcrossSources: async () => [],
        loadAllocationAvailability: async () => ({
          candidates: [
            {
              id: 'first',
              etag: '"listed-first"',
              _listOptions: { listName: 'Cases-Complaints' },
            },
            {
              id: 'second',
              etag: '"listed-second"',
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
    fireEvent(
      getByRole(view, 'button', { name: 'Request next Case' }),
      'click'
    );
    await readsComplete.promise;
    await errorLogged.promise;

    assert.deepEqual(reads, ['first', 'second']);
    assert.equal(
      actions.some(
        (action) => action.type === 'allocation/availability-changed'
      ),
      false
    );
    assert.equal(patchCalls, 0);
    assert.doesNotMatch(view.textContent, /No Cases available/);
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0][0], '[CORA] dashboard allocation failed');
    assert.equal(errorCalls[0][1], firstReadError);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    console.error = originalConsoleError;
  }
});

test('dashboard allocation resets after all candidate reads fail so a later request can retry', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  const firstReadError = new Error('initial candidate reads failed');
  const errorLogged = deferred();
  const patchComplete = deferred();
  const postClaimAvailabilityComplete = deferred();
  /** @type {string[]} */
  const reads = [];
  /** @type {any[]} */
  const patches = [];
  let availabilityChecks = 0;
  const originalConsoleError = console.error;
  console.error = (/** @type {any[]} */ ...args) => {
    if (args[1] === firstReadError) errorLogged.resolve();
  };
  try {
    ctx.client = /** @type {any} */ ({
      async getCase(/** @type {string} */ id) {
        reads.push(id);
        if (id === 'failed-first' || id === 'failed-second') {
          throw firstReadError;
        }
        return claimableRow(id, '"fresh-retry"');
      },
      async patchCase(/** @type {any[]} */ ...args) {
        patches.push(args);
        patchComplete.resolve();
        return { ok: true, status: 200 };
      },
    });
    const slice = createRouteSlice(
      {},
      ctx,
      /** @type {any} */ ({
        loadKpis: async () => [],
        listAcrossSources: async () => [],
        loadAllocationAvailability: async () => {
          const request = availabilityChecks++;
          if (request === 0) {
            return {
              candidates: [
                {
                  id: 'failed-first',
                  etag: '"listed-first"',
                  _listOptions: { listName: 'Cases-Complaints' },
                },
                {
                  id: 'failed-second',
                  etag: '"listed-second"',
                  _listOptions: { listName: 'Cases-Complaints' },
                },
              ],
              isAtCapacity: false,
            };
          }
          if (request === 1) {
            return {
              candidates: [
                {
                  id: 'retry',
                  etag: '"listed-retry"',
                  _listOptions: { listName: 'Cases-Complaints' },
                },
              ],
              isAtCapacity: false,
            };
          }
          postClaimAvailabilityComplete.resolve();
          return { candidates: [], isAtCapacity: false };
        },
      })
    );
    const tools = /** @type {any} */ ({
      context: ctx,
      params: {},
      dispatch: () => {},
      listen: () => {},
      isActive: () => true,
    });
    slice.start(tools);
    const view = slice.view(slice.initialState, tools);
    const button = getByRole(view, 'button', { name: 'Request next Case' });
    fireEvent(button, 'click');
    await errorLogged.promise;

    fireEvent(button, 'click');
    await patchComplete.promise;
    await postClaimAvailabilityComplete.promise;

    assert.deepEqual(reads, ['failed-first', 'failed-second', 'retry']);
    assert.equal(availabilityChecks, 3);
    assert.deepEqual(
      patches.map(([id, , etag]) => [id, etag]),
      [['retry', '"fresh-retry"']]
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test('dashboard allocation preserves the manager when a stale candidate returns 412', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  /** @type {any[]} */
  const patches = [];
  let managerLookups = 0;
  ctx.client = /** @type {any} */ ({
    async resolveManagers(/** @type {string[]} */ accountNames) {
      managerLookups += 1;
      assert.deepEqual(accountNames, ['u1']);
      return { u1: 'manager-1' };
    },
    async getCase(/** @type {string} */ id) {
      return claimableRow(id, `"fresh-${id}"`);
    },
    async patchCase(/** @type {any[]} */ ...args) {
      patches.push(args);
      return args[0] === 'available'
        ? { ok: true, status: 200 }
        : { ok: false, status: 412 };
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
      now: () => new Date('2026-08-14T09:00:00.000Z'),
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
  await settleAllocation(() => patches.length === 2);

  assert.deepEqual(
    patches.map(([id, fields, etag]) => [id, fields, etag]),
    [
      [
        'stale',
        {
          status: CASE_STATUS.IN_PROGRESS,
          assignedReviewer: 'u1',
          assignedReviewerManager: 'manager-1',
          dueDate: '2026-08-21',
        },
        '"fresh-stale"',
      ],
      [
        'available',
        {
          status: CASE_STATUS.IN_PROGRESS,
          assignedReviewer: 'u1',
          assignedReviewerManager: 'manager-1',
          dueDate: '2026-08-21',
        },
        '"fresh-available"',
      ],
    ]
  );
  assert.equal(managerLookups, 1);
  assert.equal(
    actions.some(
      (action) =>
        action.type === 'allocation/availability-changed' && action.isEmpty
    ),
    false
  );
});

test('dashboard allocation retries a non-412 manager write once with null, keeps it null, and stamps one due date for the whole click', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  // A clock that crosses midnight between the two candidates: the Reviewer's
  // review clock starts when they asked for a Case, so every write must carry
  // Thursday's date even though the second candidate is reached on Friday.
  const ticks = ['2026-08-13T23:59:59.000Z', '2026-08-14T00:00:01.000Z'];
  let tick = 0;
  /** @type {any[]} */
  const patches = [];
  let managerLookups = 0;
  let availabilityChecks = 0;
  ctx.client = /** @type {any} */ ({
    async resolveManagers() {
      managerLookups += 1;
      return { u1: 'manager-1' };
    },
    async getCase(/** @type {string} */ id) {
      return claimableRow(id, `"fresh-${id}"`);
    },
    async patchCase(/** @type {any[]} */ ...args) {
      patches.push(args);
      if (
        args[0] === 'first' &&
        args[1].assignedReviewerManager === 'manager-1'
      ) {
        return { ok: false, status: 403 };
      }
      if (args[0] === 'first') return { ok: false, status: 500 };
      return { ok: true, status: 200 };
    },
  });
  const candidate = (/** @type {string} */ id) => ({
    id,
    etag: `"${id}"`,
    _listOptions: { listName: 'Cases-Complaints' },
  });
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      loadAllocationAvailability: async () =>
        availabilityChecks++ === 0
          ? {
              candidates: [candidate('first'), candidate('second')],
              isAtCapacity: false,
            }
          : { candidates: [], isAtCapacity: false },
      now: () => new Date(ticks[Math.min(tick++, ticks.length - 1)]),
    })
  );
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: () => {},
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
  await settleAllocation(() => patches.length === 3);

  assert.deepEqual(
    patches.map(([id, fields]) => [id, fields]),
    [
      [
        'first',
        {
          status: CASE_STATUS.IN_PROGRESS,
          assignedReviewer: 'u1',
          assignedReviewerManager: 'manager-1',
          dueDate: '2026-08-20',
        },
      ],
      [
        'first',
        {
          status: CASE_STATUS.IN_PROGRESS,
          assignedReviewer: 'u1',
          assignedReviewerManager: null,
          dueDate: '2026-08-20',
        },
      ],
      [
        'second',
        {
          status: CASE_STATUS.IN_PROGRESS,
          assignedReviewer: 'u1',
          assignedReviewerManager: null,
          dueDate: '2026-08-20',
        },
      ],
    ]
  );
  // The manager retry is a second attempt at the same Case, so it re-sends the
  // ETag the one re-read produced rather than reading the row again.
  assert.deepEqual(
    patches.map(([, , etag]) => etag),
    ['"fresh-first"', '"fresh-first"', '"fresh-second"']
  );
  assert.equal(managerLookups, 1);
});

test('dashboard allocation does not resolve a manager at capacity or with no candidates', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  let availabilityChecks = 0;
  let managerLookups = 0;
  let patches = 0;
  ctx.client = /** @type {any} */ ({
    async resolveManagers() {
      managerLookups += 1;
      throw new Error('manager lookup should not run');
    },
    async patchCase() {
      patches += 1;
      return { ok: true, status: 200 };
    },
  });
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async () => [],
      loadAllocationAvailability: async () =>
        availabilityChecks++ === 0
          ? {
              candidates: [
                {
                  id: 'capacity-candidate',
                  etag: '"1"',
                  _listOptions: { listName: 'Cases-Complaints' },
                },
              ],
              isAtCapacity: true,
            }
          : { candidates: [], isAtCapacity: false },
    })
  );
  // Each request ends by publishing what it found, so the publish count is how
  // a test knows the previous request finished and the next click will be taken
  // rather than coalesced into it.
  let published = 0;
  const tools = /** @type {any} */ ({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => {
      if (action.type === 'allocation/availability-changed') published += 1;
    },
    listen: () => {},
    isActive: () => true,
  });
  slice.start(tools);
  const button = getByRole(slice.view(slice.initialState, tools), 'button', {
    name: 'Request next Case',
  });
  fireEvent(button, 'click');
  await settleAllocation(() => published === 1);
  fireEvent(button, 'click');
  await settleAllocation(() => published === 2);

  assert.equal(availabilityChecks, 2);
  assert.equal(managerLookups, 0);
  assert.equal(patches, 0);
});

/** @type {Array<[string, (accountNames: string[]) => Promise<any>]>} */
const managerLookupCases = [
  ['null result', async () => ({ u1: null })],
  ['missing result', async () => ({})],
  ['unusable result', async () => ({ u1: '   ' })],
];

for (const [label, resolveManagers] of managerLookupCases) {
  test(`dashboard allocation writes null manager for a ${label}`, async () => {
    const { patches, managerLookups } = await runSingleCandidateAllocation({
      resolveManagers,
    });
    assert.equal(managerLookups, 1);
    assert.deepEqual(patches[0][1], {
      status: CASE_STATUS.IN_PROGRESS,
      assignedReviewer: 'u1',
      assignedReviewerManager: null,
      dueDate: '2026-08-21',
    });
  });
}

test('dashboard allocation writes null manager when manager lookup rejects', async () => {
  const { patches, managerLookups } = await runSingleCandidateAllocation({
    resolveManagers: async () => {
      throw new Error('directory unavailable');
    },
  });
  assert.equal(managerLookups, 1);
  assert.deepEqual(patches[0][1], {
    status: CASE_STATUS.IN_PROGRESS,
    assignedReviewer: 'u1',
    assignedReviewerManager: null,
    dueDate: '2026-08-21',
  });
});

test("dashboard allocation stamps the Case Type's declared review SLA across the Christmas holidays", async () => {
  // Ten working days from Friday 18 December 2026 skips Christmas Day, the
  // Boxing Day substitute and New Year's Day, landing on 6 January 2027 — a
  // date neither the default of five nor a weekends-only count could produce.
  const { patches } = await runSingleCandidateAllocation({
    nowIso: '2026-12-18T16:45:00.000Z',
    reviewSlaWorkingDays: 10,
  });

  assert.equal(patches[0][1].dueDate, '2027-01-06');
});

test('dashboard allocation keys the review SLA by list and falls back to the default when no Case source matches', async () => {
  // The declared ten sits on a source the candidate's list does not match, so a
  // lookup that stopped discriminating by list would stamp 2026-08-28 instead.
  const { patches } = await runSingleCandidateAllocation({
    listName: 'Cases-Unregistered',
    reviewSlaWorkingDays: 10,
  });

  assert.equal(patches[0][1].dueDate, '2026-08-21');
});

test('dashboard allocation exhausts stale candidates and renders the resulting empty state', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  ctx.client = /** @type {any} */ ({
    async getCase(/** @type {string} */ id) {
      return claimableRow(id, '"fresh-stale"');
    },
    async patchCase() {
      return { ok: false, status: 412 };
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
  await settleAllocation(() =>
    actions.some((action) => action.type === 'allocation/availability-changed')
  );

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
    async getCase(/** @type {string} */ id) {
      return claimableRow(id, '"fresh-late"');
    },
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
  await settleAllocation(() =>
    actions.some((action) => action.type === 'allocation/availability-changed')
  );

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
    async getCase(/** @type {string} */ id) {
      return claimableRow(id, '"fresh-late-stale"');
    },
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
  await settleAllocation(() =>
    actions.some((action) => action.type === 'allocation/availability-changed')
  );

  assert.equal(
    actions.some((action) => action.type === 'allocation/availability-changed'),
    false
  );
});

test('dashboard allocation immediately publishes capacity after the claim that reaches the limit', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  let patches = 0;
  ctx.client = /** @type {any} */ ({
    async getCase(/** @type {string} */ id) {
      return claimableRow(id, '"fresh-third"');
    },
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
  assert.deepEqual(state.routes.dashboard.actionCentre.counts, {});
  state = slice.reducer(state, {
    type: 'action-centre/counts-loaded',
    counts: { overdue: 2 },
    peeks: { overdue: null },
    headline: 2,
  });
  const countedView = dashboardView(state, {
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
  assert.equal(
    /** @type {any} */ (state.routes.dashboard.actionCentre.pages).overdue
      .length,
    2
  );
  assert.equal(state.routes.dashboard.actionCentre.counts.overdue, 2);
  assert.equal(state.routes.dashboard.actionCentre.headline, 2);
  assert.doesNotMatch(
    countedView.querySelector('.cora-action-centre')?.textContent ?? '',
    /Nothing in your worklist right now/
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
  // One row that every panel on the page has a reason to show: overdue for the
  // Reviewer table, remediation for the Responsible Party panel, an open appeal
  // for Controls, and the signed-in user on both people fields.
  const caseRow = makeCaseRow({
    id: 'c1',
    title: 'Case c1',
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
        author: { loginName: 'reviewer', displayName: 'Robin Reviewer' },
        timestamp: '2026-06-01T00:00:00Z',
        body: 'Update',
      },
    ],
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
      toggleGroup: (_state, reason) => actions.push(['group', reason.id]),
      showMore: (_state, reason) => actions.push(['more', reason.id]),
    },
  });

  assert.ok(view.querySelector('.cora-kpi-strip'));
  assert.ok(view.querySelector('.cora-action-centre'));
  assert.ok(view.querySelector('.cora-reviewer-cases'));
  assert.ok(view.querySelector('.cora-rp-remediation'));
  // The Controls Appeals panel is absent only because the Appeals feature
  // switch is off; restore `assert.ok(view.querySelector('.cora-controls-appeals'))`
  // when the switch goes — this test is the one that proves the panel is wired
  // into the page at all.
  assert.equal(view.querySelector('.cora-controls-appeals'), null);
  assert.ok(view.querySelector('.cora-owner-summary-heading'));
  assert.ok(view.querySelector('.cora-allocation-btn'));
  assert.equal(view.querySelector('cora-owner-summary'), null);
  assert.equal(view.querySelector('cora-allocation'), null);

  [...view.querySelectorAll('button')].forEach((button) =>
    fireEvent(button, 'click', { bubbles: false })
  );
  // Not `actions.length > 0`: that aggregate stayed true while individual
  // Action Centre seams were no-ops. Name every controller callback the
  // panel is supposed to reach, in document order.
  const reasonIds =
    slice.initialState.routes.dashboard.actionCentre.reasons.map(
      (/** @type {any} */ reason) => reason.id
    );
  assert.deepEqual(
    actions.filter((action) => Array.isArray(action)),
    [
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
  // The hash left by the last navigating button in document order. The Appeals
  // panel is last in the panel list, so while appeals were on this read
  // '#/case/complaints/c1' — its Open button opens the Case. With the panel
  // switched off, the Responsible Party panel's "Open conversation" is now the
  // last to navigate — and since #790 that opens the Case too, so the expected
  // hash is the same either way.
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

test('dashboard Action Centre controller reloads groups and pages through store actions', async () => {
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
          makeCaseRow({
            id: `${reason.id}-${skip}`,
            title: `${reason.id}-${skip}`,
            assignedReviewer: 'u1',
            responsibleParty: 'rp',
            dueDate: '2020-01-01T00:00:00Z',
            overdue: true,
            etag: 'e',
          }),
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

  assert.ok(countLoads >= 1);
  assert.ok(pageLoads >= 2);
  dispose?.();
});

test('dashboard view: clicking a reviewer column header dispatches the reviewer table sort action', () => {
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

// Appeals are switched off in this build, so `dashboardView` composes no
// Appeals panel and there is no column header in the rendered tree to click.
// What survives here is the half the switch does not reach: the slice's own
// Appeals state — its default sort, and the two reducers behind loading and
// re-sorting the table. The rendering half — that clicking `Raised`,
// `Reference` or `Case Type` dispatches the sort and re-orders the rows within
// `.cora-controls-appeals` — moves to `dashboard-controls-view.test.js`, which
// drives the panel view directly and is unaffected by the switch. When the
// switch goes, a test that clicks through `dashboardView` is worth restoring:
// it is the only thing that proves the panel is wired into the page at all.
test('dashboard slice: Appeals state loads and re-sorts, default oldest-raised first', () => {
  const ctx = context(capabilities({ isControls: true }));
  const slice = createRouteSlice({}, ctx);
  // The Appeals table's deliberate default, unmoved by gaining two sortable
  // columns.
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
  const cases = [
    appealRow('Zed case', 'sales'),
    appealRow('Alpha case', 'banking'),
  ];
  const loaded = slice.reducer(slice.initialState, {
    type: 'appeals/loaded',
    cases,
  });
  assert.deepEqual(loaded.routes.dashboard.appealCases, cases);

  // A new key sorts ascending; re-requesting the key already sorted on flips
  // the direction rather than restarting it.
  for (const key of ['reference', 'caseType']) {
    const sorted = slice.reducer(loaded, {
      type: 'appeals-table/sort-requested',
      key,
    });
    assert.deepEqual(sorted.routes.dashboard.appealSort, { key, dir: 'asc' });
  }
  const toggled = slice.reducer(loaded, {
    type: 'appeals-table/sort-requested',
    key: 'raised',
  });
  assert.deepEqual(toggled.routes.dashboard.appealSort, {
    key: 'raised',
    dir: 'desc',
  });
});

test('dashboard slice: navigating away aborts the fan-out reads with no error UI', async () => {
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
});

test('dashboard Action Centre: an aborted count or page load dispatches nothing', async () => {
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
});

test('dashboard Action Centre: an aborted reason-page read renders no rows and no error', async () => {
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
});

test('dashboard slice: a client-less mount with a mount signal renders an empty dashboard rather than failing the route', async () => {
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
});

/*
 * Page-wiring audit — seams deliberately left uncovered here, and why. (The audit's
 * page-wiring assertions live in this file, cora-case-review-slice.test.js,
 * cora-responsible-party-dashboard-loading.test.js and
 * question-bank-slice.test.js.)
 *
 * - Table sort headers on the Dashboard reviewer + appeals tables, My Team, and
 *   the Responsible Party remediation + unread tables: already asserted
 *   click→dispatch by the table sort tests. Covered elsewhere, not gaps.
 * - The question-bank sub-editors (options-editor, wording-editor, showwhen-*,
 *   question-labels): every card edit reaches the store through the one
 *   `BankList` dispatch prop, which the `bank editor: the BankList dispatch
 *   carries a card edit` test asserts. Covering each sub-editor separately would
 *   re-assert the same seam.
 * - Case Review Section panels (summary/outcome/notes/appeal views): asserted
 *   through the shipped route render in cora-case-review-slice.test.js rather
 *   than by stub handlers, so the page wiring is already in the assertion path.
 * - `dashboard/controls-view.js`'s row links and `action-centre-view.js`'s row
 *   anchors: plain `href` navigation with no page-supplied callback, so there is
 *   no wiring seam to mis-wire.
 */

test('dashboard KPI strip: a lane header and a tile dispatch the disclosure actions the reducer owns', () => {
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

test('dashboard Action Centre: its own Open button navigates to the Case', () => {
  // The reviewer worklist has an Open button too, so the query below is scoped
  // to `.cora-action-centre` — this assertion must fail when *this* panel stops
  // navigating, not be satisfied by the other one. A Controls-only user used to
  // give that isolation for free, holding an Action Centre reason without a
  // worklist; with Appeals switched off, Controls holds no reason at all, so
  // the scoping is now doing the work on its own.
  const ctx = context(capabilities({ isReviewer: true }));
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
                title: 'Worklist case',
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
      button.getAttribute('aria-label') === 'Open Worklist case'
  );
  fireEvent(open, 'click');
  assert.equal(location.hash, '#/case/complaints/c7');
});

test('dashboard Action Centre: the group header and Show more reach the panel’s own controller', () => {
  // `onToggleGroup` and `onShowMore` are the last two Action Centre seams the
  // page owns. Stubbing either to a no-op used to leave the suite green while
  // the header stopped expanding and pagination died silently.
  //
  // A Reviewer rather than Controls: with Appeals switched off, Controls holds
  // no Action Centre reason, so there would be no group to expand.
  const ctx = context(capabilities({ isReviewer: true }));
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
          title: 'Worklist case',
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

test('dashboard Responsible Party panel: Open conversation navigates to the Conversation route', () => {
  // The embedded panel is the only one that opts into navigation; #/my-cases
  // deliberately keeps the historic no-navigation Open (see the slice).
  const ctx = context(capabilities({ isAdviser: true }));
  const slice = createRouteSlice({}, ctx);
  const route = slice.initialState.routes.dashboard;
  // The signed-in user is the Responsible Party here, and the last message came
  // from the Reviewer, which is what puts the Case in the unread panel.
  const unread = makeCaseRow({
    id: 'c4',
    title: 'Unread case',
    status: 'Actions In Progress',
    assignedReviewer: 'reviewer',
    responsibleParty: 'u1',
    remediationDueDate: '2026-01-01T00:00:00Z',
    answers: {
      q1: { value: 'No', remediationActions: [{ id: 'a1', text: 'Fix' }] },
    },
    conversation: [
      {
        author: { loginName: 'reviewer', displayName: 'Robin Reviewer' },
        timestamp: '2026-02-01T00:00:00Z',
        body: 'hi',
      },
    ],
    etag: 'e',
  });
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
  // The Conversation is a Section of the Case Review page, not a route (#790):
  // the button opens the Case, which gates access and opens the Conversation
  // panel when that is the only Section this reader may see.
  assert.equal(location.hash, '#/case/complaints/c4');
});

test('the reviewer status filter offers exactly the statuses the panel fetches', async () => {
  // The claim is that the two agree, so neither side is respelled here: the
  // expected options are read off the query the panel actually issued. An option
  // the fetch never returns would be a control that only empties the table.
  const ctx = context(capabilities({ isReviewer: true }));
  /** @type {any[]} */
  const filters = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async (
        /** @type {any} */ _client,
        /** @type {any} */ _sources,
        /** @type {any} */ filter
      ) => {
        filters.push(filter);
        return [];
      },
    })
  );
  slice.start({
    context: ctx,
    params: {},
    dispatch: () => {},
    listen: () => {},
    isActive: () => true,
  });
  await Promise.resolve();

  const fetched = filters[0].anyOf.map(
    (/** @type {any} */ branch) => branch.status
  );
  assert.ok(fetched.length > 1, 'the panel fetches more than one status');

  const view = dashboardView(slice.initialState, {
    context: ctx,
    dispatch: () => {},
  });
  const options = [
    .../** @type {any} */ (
      view.querySelector('[aria-label="Filter by status"]')
    ).querySelectorAll('option'),
  ];
  assert.deepEqual(
    options.map((option) => /** @type {any} */ (option).value),
    ['', ...fetched]
  );
  assert.deepEqual(
    options.map((option) => option.textContent),
    ['All statuses', ...fetched]
  );
});

test('the reviewer status filter can isolate Actions In Progress Cases', () => {
  const ctx = context(capabilities({ isReviewer: true }));
  ctx.client = null;
  const slice = createRouteSlice({}, ctx);
  const loaded = slice.reducer(slice.initialState, {
    type: 'reviewer-cases/loaded',
    cases: [
      {
        id: 'alpha',
        title: 'Alpha case',
        caseType: 'complaints',
        status: CASE_STATUS.IN_PROGRESS,
      },
      {
        id: 'gamma',
        title: 'Gamma case',
        caseType: 'complaints',
        status: CASE_STATUS.ACTIONS_IN_PROGRESS,
      },
    ],
  });
  const filtered = slice.reducer(loaded, {
    type: 'reviewer-table/status-filter-changed',
    value: CASE_STATUS.ACTIONS_IN_PROGRESS,
  });
  const view = dashboardView(/** @type {any} */ (filtered), {
    context: ctx,
    dispatch: () => {},
  });
  const body = view.querySelector('.cora-reviewer-cases')?.textContent ?? '';
  assert.match(body, /Gamma case/);
  assert.doesNotMatch(body, /Alpha case/);
});

test('the Outstanding Cases panel fetches both of the statuses it calls outstanding', async () => {
  const ctx = context(capabilities({ isReviewer: true }));
  /** @type {any[]} */
  const filters = [];
  const slice = createRouteSlice(
    {},
    ctx,
    /** @type {any} */ ({
      loadKpis: async () => [],
      listAcrossSources: async (
        /** @type {any} */ _client,
        /** @type {any} */ _sources,
        /** @type {any} */ filter
      ) => {
        filters.push(filter);
        return [];
      },
    })
  );
  slice.start({
    context: ctx,
    params: {},
    dispatch: () => {},
    listen: () => {},
    isActive: () => true,
  });
  await Promise.resolve();

  assert.deepEqual(filters, [
    {
      anyOf: [
        { status: CASE_STATUS.IN_PROGRESS },
        { status: CASE_STATUS.ACTIONS_IN_PROGRESS },
      ],
      assignedReviewer: 'u1',
    },
  ]);
});
