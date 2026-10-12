// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import { makeCaseRow } from './helpers/fixtures.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { createRouteSlice, frontlineCasesView } =
  await import('../src/pages/cora-frontline-cases.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

const FRONTLINE_SOURCES = [
  {
    slug: 'complaints',
    listName: 'Cases-Complaints',
    displayName: 'Complaints',
  },
];

function context() {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      currentUser: { id: 'team-member-1', displayName: 'Team Member' },
      permissions: {},
    },
    // A different, wider set than the team's own: the page must read the
    // frontline projection, not every source the viewer could open.
    caseSources: [
      ...FRONTLINE_SOURCES,
      { slug: 'other', listName: 'Cases-Other', displayName: 'Other' },
    ],
    frontlineCaseSources: FRONTLINE_SOURCES,
  });
}

/** @param {string} id @returns {CaseRow} */
function sentCase(id) {
  return makeCaseRow({
    id,
    caseType: 'complaints',
    title: `Case ${id}`,
    status: 'Actions In Progress',
    assignedReviewer: 'r',
    responsibleParty: '',
    etag: 'e',
    answers: {
      q1: {
        value: 'No',
        remediationActions: [{ id: 'a1', text: 'Call the customer' }],
      },
    },
  });
}

test('frontline cases slice: lists every Case of the team Case Types, with no person filter', async () => {
  const cases = [sentCase('c1')];
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const actions = [];
  /** @type {() => void} */
  let markLoaded = () => {};
  const loaded = new Promise((resolve) => {
    markLoaded = () => resolve(undefined);
  });
  const ctx = context();
  const slice = createRouteSlice({}, ctx, {
    listAcrossSources: async (_client, sources, filter) => {
      calls.push({ sources, filter });
      return cases;
    },
  });

  slice.start({
    dispatch: (/** @type {any} */ action) => {
      actions.push(action);
      markLoaded();
    },
    context: ctx,
    signal: new AbortController().signal,
    isActive: () => true,
  });
  await loaded;

  assert.deepEqual(calls, [{ sources: FRONTLINE_SOURCES, filter: {} }]);
  assert.deepEqual(actions, [{ type: 'responsible-party/loaded', cases }]);
});

test('frontline cases slice: a mount with no client reads nothing', () => {
  let called = false;
  const slice = createRouteSlice({}, context(), {
    listAcrossSources: async () => {
      called = true;
      return [];
    },
  });
  slice.start({ context: { ...context(), client: null } });
  assert.equal(called, false);
});

test('frontline cases slice: a load that lands after navigating away is dropped', async () => {
  /** @type {any[]} */
  const actions = [];
  const ctx = context();
  const slice = createRouteSlice({}, ctx, {
    listAcrossSources: async () => [sentCase('c1')],
  });
  /** @type {() => void} */
  let markChecked = () => {};
  const checked = new Promise((resolve) => {
    markChecked = () => resolve(undefined);
  });
  slice.start({
    dispatch: (/** @type {any} */ action) => actions.push(action),
    context: ctx,
    signal: new AbortController().signal,
    isActive: () => {
      markChecked();
      return false;
    },
  });
  await checked;
  assert.deepEqual(actions, []);
});

test('frontline cases view: the team sees the Responsible Party queue under its own heading', () => {
  const slice = createRouteSlice({}, context());
  const state = slice.reducer(slice.initialState, {
    type: 'responsible-party/loaded',
    cases: [sentCase('c1')],
  });
  const view = frontlineCasesView(state, { dispatch: () => {} });

  assert.equal(view.querySelector('h1')?.textContent, 'Frontline Cases');
  assert.match(view.textContent ?? '', /Outstanding Remediation Actions/);
  assert.ok(
    findByClass(view, 'cora-remediation-row'),
    'a Case naming nobody is still on the team queue'
  );
  assert.equal(
    slice.reducer(state, { type: 'ignored' }),
    state,
    'an action the queue does not own leaves the state alone'
  );
});
