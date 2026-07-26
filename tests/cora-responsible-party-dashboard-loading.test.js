// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { createRouteSlice } =
  await import('../src/pages/cora-responsible-party-dashboard.js');

function context() {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/my-cases' },
      currentUser: { id: 'rp-1', displayName: 'RP' },
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

test('Responsible Party slice fetches across authorized sources with the current user filter', async () => {
  const ctx = context();
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const actions = [];
  /** @type {() => void} */
  let markLoaded = () => {};
  /** @type {Promise<void>} */
  const loaded = new Promise((resolve) => {
    markLoaded = resolve;
  });
  const slice = createRouteSlice({}, ctx, {
    listAcrossSources: async (...args) => {
      calls.push(args);
      return [];
    },
  });
  slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => {
      actions.push(action);
      markLoaded();
    },
    isActive: () => true,
  });
  await loaded;

  assert.equal(calls[0][2].responsibleParty, 'rp-1');
  assert.equal(calls[0][1], ctx.caseSources);
  assert.deepEqual(actions, [{ type: 'responsible-party/loaded', cases: [] }]);
});

test('Responsible Party slice cleanup suppresses a late fetch result', async () => {
  const ctx = context();
  /** @type {(rows: any[]) => void} */
  let resolveRows = () => {};
  const slice = createRouteSlice({}, ctx, {
    listAcrossSources: () =>
      new Promise((resolve) => {
        resolveRows = resolve;
      }),
  });
  /** @type {any[]} */
  const actions = [];
  let active = true;
  slice.start({
    context: ctx,
    params: {},
    dispatch: (/** @type {any} */ action) => actions.push(action),
    isActive: () => active,
  });
  active = false;
  resolveRows([]);
  await Promise.resolve();
  assert.deepEqual(actions, []);

  const view = slice.view(slice.initialState, { dispatch: () => {} });
  // Existing DOM-stub debt retained until the shared debt ledger can move.
  assert.ok(/** @type {any} */ (view)._children);
  assert.ok(/** @type {any} */ (view)._children.length > 0);
  assert.ok(/** @type {any} */ (view)._children[0]);
});

test('Responsible Party reducer owns loaded rows, filters, and both table sorts', () => {
  const slice = createRouteSlice({}, context());
  let state = slice.reducer(slice.initialState, {
    type: 'responsible-party/loaded',
    cases: [{ id: 'c1' }],
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

  assert.equal(state.routes.responsibleParty.cases.length, 1);
  assert.equal(state.routes.responsibleParty.filter, 'complaints');
  assert.equal(state.routes.responsibleParty.remediationSort?.dir, 'desc');
  assert.equal(state.routes.responsibleParty.messageSort?.dir, 'asc');
  assert.equal(slice.reducer(state, { type: 'ignored' }), state);
});
