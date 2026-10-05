// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  definitionFor,
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';
import {
  makeCaseRow,
  makeChrome,
  makePermissions,
} from './helpers/fixtures.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { createRouteSlice, caseSupportRouteFor, SUPPORT_ACTIONS } =
  await import('../src/pages/cora-case-support.js');
const { APP_CONFIG } = await import('../src/app-config.js');

const SOURCES = [
  {
    slug: 'complaints',
    listName: 'Cases-Complaints',
    displayName: 'Complaints',
  },
  {
    slug: 'example-review',
    listName: 'Cases-ExampleReview',
    displayName: 'Example Review',
  },
];

/** @param {Record<string, unknown>} [overrides] */
function context(overrides = {}) {
  return /** @type {any} */ ({
    client: {},
    chrome: makeChrome({ permissions: { isMaintainer: true } }),
    caseSources: SOURCES,
    ...overrides,
  });
}

/**
 * @param {any} ctx
 * @param {any[]} actions
 * @param {Record<string, unknown>} [over]
 */
function startTools(ctx, actions, over = {}) {
  return /** @type {any} */ ({
    dispatch: (/** @type {any} */ action) => actions.push(action),
    context: ctx,
    isActive: () => true,
    ...over,
  });
}

/** @param {any} slice @param {any} state */
function viewOf(slice, state) {
  return slice.view(state, { dispatch: () => {} });
}

/** @param {any} slice @param {any[]} actions */
function replay(slice, actions) {
  return actions.reduce(
    (state, action) => slice.reducer(state, action),
    slice.initialState
  );
}

async function flush(n = 20) {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

test('case support route: only a Maintainer may open it or see its link', () => {
  const entry = APP_CONFIG.pagePlugins.find(
    (plugin) => plugin.id === 'case-support'
  );
  assert.ok(entry?.guard, 'the route is guarded, not just the link');
  assert.equal(entry.guard(makePermissions({ isMaintainer: true })), true);
  for (const other of [
    { isReviewer: true },
    { isControls: true, canSearchCases: true },
    { isReviewerManager: true },
    { isReviewer: false, ownedCaseTypes: ['complaints'] },
  ]) {
    assert.equal(
      entry.guard(makePermissions(other)),
      false,
      JSON.stringify(other)
    );
  }
  assert.equal(entry.nav?.label, 'Case Support');
});

test('case support: with no reference the page asks for one and reads nothing', async () => {
  let searched = false;
  const ctx = context();
  const slice = createRouteSlice({ queryString: '' }, ctx, {
    searchCases: async () => {
      searched = true;
      return { rows: [], capped: false };
    },
  });

  slice.start(startTools(ctx, []));
  await flush();

  assert.equal(searched, false);
  const view = viewOf(slice, slice.initialState);
  assert.match(view.textContent, /Enter a Case Reference/);
  assert.ok(getByRole(view, 'search'));
});

test('case support: a reference in the URL searches every Case source for it', async () => {
  /** @type {any[]} */
  const calls = [];
  const ctx = context();
  const rows = [makeCaseRow({ id: '7', title: 'CR-7' })];
  const slice = createRouteSlice({ queryString: '?reference=CR-7' }, ctx, {
    searchCases: async (...args) => {
      calls.push(args);
      return { rows, capped: false };
    },
  });

  /** @type {any[]} */
  const actions = [];
  slice.start(startTools(ctx, actions));
  await flush();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { titlePrefix: 'CR-7' });
  assert.equal(calls[0][2], SOURCES);
  assert.deepEqual(actions, [
    { type: 'case-support/search-loaded', rows, capped: false },
  ]);
});

test('case support: a match opens the Case on this page, not in Case Review', () => {
  location.hash = '';
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?reference=CR' }, ctx);
  const state = slice.reducer(slice.initialState, {
    type: 'case-support/search-loaded',
    rows: [makeCaseRow({ id: '7', title: 'CR-7', caseType: 'complaints' })],
    capped: false,
  });

  fireEvent(
    getByRole(viewOf(slice, state), 'button', { name: 'Open CR-7' }),
    'click'
  );
  assert.equal(location.hash, '#/case-support/complaints/7');
});

test('case support: a saturated result asks for more of the reference', () => {
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?reference=CR' }, ctx);
  const state = slice.reducer(slice.initialState, {
    type: 'case-support/search-loaded',
    rows: [makeCaseRow()],
    capped: true,
  });
  assert.match(viewOf(slice, state).textContent, /Enter more of the reference/);
});

test('case support: in flight shows the loading placeholder, no match the empty one', () => {
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?reference=CR' }, ctx);
  assert.ok(viewOf(slice, slice.initialState).querySelector('.cora-loading'));

  const empty = viewOf(
    slice,
    slice.reducer(slice.initialState, {
      type: 'case-support/search-loaded',
      rows: [],
      capped: false,
    })
  );
  assert.match(empty.textContent, /No Cases match this reference/);
  assert.equal(empty.querySelector('table'), null);
});

test('case support: a failed search is reported in the page', async () => {
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?reference=CR' }, ctx, {
    searchCases: async () => {
      throw new Error('list unavailable');
    },
  });
  /** @type {any[]} */
  const actions = [];
  slice.start(startTools(ctx, actions));
  await flush();

  const alert = getByRole(viewOf(slice, replay(slice, actions)), 'alert');
  assert.match(alert.textContent, /could not be completed.*list unavailable/);
});

test('case support: finding writes the trimmed reference into the URL', () => {
  location.hash = '';
  const ctx = context();
  const slice = createRouteSlice({ queryString: '' }, ctx);
  const state = slice.reducer(slice.initialState, {
    type: 'case-support/reference-changed',
    reference: '  CR-1/2 ',
  });

  const search = getByRole(viewOf(slice, state), 'search');
  assert.equal(
    search.tagName.toLowerCase(),
    'div',
    'a form here would nest inside the host page form and post it back'
  );
  fireEvent(getByRole(search, 'button', { name: 'Find Case' }), 'click');
  assert.equal(location.hash, '#/case-support?reference=CR-1%2F2');

  location.hash = '';
  fireEvent(search, 'keydown', { key: 'Enter' });
  assert.equal(location.hash, '#/case-support?reference=CR-1%2F2');

  location.hash = '';
  fireEvent(search, 'keydown', { key: 'a' });
  assert.equal(location.hash, '', 'only Enter finds');
});

test('case support: an empty reference returns to the bare page', () => {
  location.hash = '';
  const slice = createRouteSlice({ queryString: '' }, context());
  fireEvent(
    getByRole(viewOf(slice, slice.initialState), 'button', {
      name: 'Find Case',
    }),
    'click'
  );
  assert.equal(location.hash, '#/case-support');
});

test('case support: typing in the reference box is held in state', () => {
  const slice = createRouteSlice({ queryString: '' }, context());
  /** @type {any[]} */
  const dispatched = [];
  const view = slice.view(slice.initialState, {
    dispatch: (/** @type {any} */ action) => dispatched.push(action),
  });
  const input = /** @type {any} */ (view.querySelector('input'));
  input.value = 'CR-9';
  fireEvent(input, 'input');
  assert.deepEqual(dispatched, [
    { type: 'case-support/reference-changed', reference: 'CR-9' },
  ]);
});

test('case support: a selected Case is read from its own Case Type list', async () => {
  /** @type {any[]} */
  const reads = [];
  const row = makeCaseRow({
    id: '42',
    caseType: 'example-review',
    title: 'CR-42',
    status: CASE_STATUS.COMPLETED,
    responsiblePartyDisplayName: 'Jordan RP',
    dueDate: '2026-02-03',
    reportableAt: '2026-02-01T09:00:00Z',
    completedAt: '2026-02-04T09:00:00Z',
  });
  const ctx = context({
    client: {
      async getCase(/** @type {string} */ id, /** @type {any} */ opts) {
        reads.push([id, opts.listName]);
        return row;
      },
    },
  });
  const slice = createRouteSlice(
    { caseType: 'example-review', id: '42', queryString: '' },
    ctx
  );

  assert.ok(viewOf(slice, slice.initialState).querySelector('.cora-loading'));

  /** @type {any[]} */
  const actions = [];
  slice.start(startTools(ctx, actions));
  await flush();

  assert.deepEqual(reads, [['42', 'Cases-ExampleReview']]);
  const view = viewOf(slice, replay(slice, actions));

  assert.equal(getByRole(view, 'heading', { name: 'CR-42' }).tagName, 'H2');
  assert.equal(definitionFor(view, 'Case Type').textContent, 'Example Review');
  assert.equal(definitionFor(view, 'Status').textContent, 'Completed');
  assert.equal(
    definitionFor(view, 'Responsible Party').textContent,
    'Jordan RP'
  );
  assert.equal(definitionFor(view, 'Due Date').textContent, '03/02/2026');
  assert.equal(definitionFor(view, 'Completed on').textContent, '04/02/2026');
  const open = /** @type {any} */ (view.querySelector('a'));
  assert.equal(open.textContent, 'Open in Case Review');
  assert.equal(open.href, '#/case/example-review/42');
});

test('case support: every support action is offered, and none can be taken yet', () => {
  const slice = createRouteSlice(
    { caseType: 'complaints', id: '1', queryString: '' },
    context()
  );
  const state = slice.reducer(slice.initialState, {
    type: 'case-support/case-loaded',
    row: makeCaseRow({ id: '1', title: 'CR-1' }),
  });
  const view = viewOf(slice, state);

  for (const action of SUPPORT_ACTIONS) {
    assert.ok(
      getByRole(view, 'heading', { name: action.title }),
      `${action.id} has a card`
    );
  }
  const buttons = queryAllByRole(view, 'button', {
    name: 'Not available yet',
  });
  assert.equal(buttons.length, SUPPORT_ACTIONS.length);
  for (const button of buttons) assert.equal(button.disabled, true);

  assert.ok(getByRole(view, 'heading', { name: 'Support log' }));
});

test('case support: only a voided Case shows when it was voided', () => {
  const slice = createRouteSlice(
    { caseType: 'complaints', id: '1', queryString: '' },
    context()
  );
  /** @param {any} row */
  const viewFor = (row) =>
    viewOf(
      slice,
      slice.reducer(slice.initialState, {
        type: 'case-support/case-loaded',
        row,
      })
    );

  assert.doesNotMatch(viewFor(makeCaseRow()).textContent, /Voided/);
  const voided = viewFor(
    makeCaseRow({ status: CASE_STATUS.VOID, voidedAt: '2026-03-01T10:00:00Z' })
  );
  assert.equal(definitionFor(voided, 'Voided on').textContent, '01/03/2026');
});

test('case support: an unknown Case Type in the URL is named, and nothing is read', async () => {
  let read = false;
  const ctx = context({
    client: {
      async getCase() {
        read = true;
        return null;
      },
    },
  });
  const slice = createRouteSlice(
    { caseType: 'nope', id: '1', queryString: '' },
    ctx
  );
  /** @type {any[]} */
  const actions = [];
  slice.start(startTools(ctx, actions));
  await flush();

  assert.equal(read, false);
  assert.match(
    getByRole(viewOf(slice, replay(slice, actions)), 'alert').textContent,
    /No Case Type "nope" is available to you/
  );
});

test('case support: a Case that does not exist says so rather than loading for ever', async () => {
  const ctx = context({ client: { getCase: async () => null } });
  const slice = createRouteSlice(
    { caseType: 'complaints', id: '99', queryString: '' },
    ctx
  );
  /** @type {any[]} */
  const actions = [];
  slice.start(startTools(ctx, actions));
  await flush();

  assert.match(
    getByRole(viewOf(slice, replay(slice, actions)), 'alert').textContent,
    /No Case with id "99" was found in Complaints/
  );
});

test('case support: a failed Case read is reported in the page', async () => {
  const ctx = context({
    client: {
      getCase: async () => {
        throw new Error('403');
      },
    },
  });
  const slice = createRouteSlice(
    { caseType: 'complaints', id: '1', queryString: '' },
    ctx
  );
  /** @type {any[]} */
  const actions = [];
  slice.start(startTools(ctx, actions));
  await flush();

  assert.match(
    getByRole(viewOf(slice, replay(slice, actions)), 'alert').textContent,
    /could not be loaded.*403/
  );
});

test('case support: navigating away mid-read dispatches nothing', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  for (const [params, client, deps] of [
    [
      { caseType: 'complaints', id: '1', queryString: '' },
      { getCase: async () => makeCaseRow() },
      {},
    ],
    [
      { caseType: 'complaints', id: '1', queryString: '' },
      {
        getCase: async () => {
          throw abort;
        },
      },
      {},
    ],
    [
      { queryString: '?reference=CR' },
      {},
      { searchCases: async () => ({ rows: [], capped: false }) },
    ],
    [
      { queryString: '?reference=CR' },
      {},
      {
        searchCases: async () => {
          throw abort;
        },
      },
    ],
  ]) {
    const ctx = context({ client });
    const slice = createRouteSlice(
      /** @type {any} */ (params),
      ctx,
      /** @type {any} */ (deps)
    );
    /** @type {any[]} */
    const actions = [];
    slice.start(startTools(ctx, actions, { isActive: () => false }));
    await flush();
    assert.deepEqual(actions, [], JSON.stringify(params));
  }
});

test('case support: an aborted read is navigation, not a failure', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const ctx = context({
    client: {
      getCase: async () => {
        throw abort;
      },
    },
  });
  const slice = createRouteSlice(
    { caseType: 'complaints', id: '1', queryString: '' },
    ctx
  );
  /** @type {any[]} */
  const actions = [];
  slice.start(startTools(ctx, actions));
  await flush();
  assert.deepEqual(actions, []);
});

test('case support: without a client the page still renders and reads nothing', () => {
  const ctx = context({ client: null });
  const slice = createRouteSlice({ queryString: '?reference=CR' }, ctx);
  assert.doesNotThrow(() => slice.start(startTools(ctx, [])));
});

test('case support: a Case-load result for no selected Case is ignored', () => {
  const slice = createRouteSlice({ queryString: '' }, context());
  for (const action of [
    { type: 'case-support/case-loaded', row: makeCaseRow() },
    { type: 'case-support/case-failed', message: 'x' },
    { type: 'unrelated/event' },
  ]) {
    assert.equal(slice.reducer(slice.initialState, action), slice.initialState);
  }
});

test('case support: the route for a Case encodes its parts', () => {
  assert.equal(
    caseSupportRouteFor({ caseType: 'a b', id: '1/2' }),
    '#/case-support/a%20b/1%2F2'
  );
});
