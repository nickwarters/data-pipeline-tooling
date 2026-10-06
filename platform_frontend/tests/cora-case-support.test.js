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
const { MockSharePointClient } =
  await import('../src/services/mock-sharepoint-client.js');
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

/**
 * A Maintainer's route context whose client has an empty Support Log unless it brings one.
 *
 * @param {Record<string, any>} [overrides]
 */
function context(overrides = {}) {
  const { client = {}, ...rest } = overrides;
  return /** @type {any} */ ({
    client: client && { listSupportLog: async () => [], ...client },
    chrome: makeChrome({ permissions: { isMaintainer: true } }),
    caseSources: SOURCES,
    ...rest,
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

test('case support: every support action has a card, and only a built one can be started', () => {
  const { view } = live();

  for (const action of SUPPORT_ACTIONS) {
    assert.ok(
      getByRole(view(), 'heading', { name: action.title }),
      `${action.id} has a card`
    );
  }
  const unbuilt = queryAllByRole(view(), 'button', {
    name: 'Not available yet',
  });
  assert.ok(unbuilt.length < SUPPORT_ACTIONS.length);
  for (const button of unbuilt) assert.equal(button.disabled, true);
  for (const built of ['Reassign', 'Un-assign']) {
    assert.equal(getByRole(view(), 'button', { name: built }).disabled, false);
  }
  assert.ok(
    getByRole(view(), 'button', { name: 'Reopen' }),
    'Reopen is built, though this In-progress Case cannot use it'
  );
  assert.ok(getByRole(view(), 'heading', { name: 'Support log' }));
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
  assert.deepEqual(
    actions.filter((action) => action.type.endsWith('-failed')),
    []
  );
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
    { type: 'case-support/log-loaded', entries: [] },
    { type: 'case-support/log-failed', message: 'x' },
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

/** @param {Partial<import('../src/sharepoint-client.js').SupportLogEntry>} [overrides] */
function logEntry(overrides = {}) {
  return {
    id: '1',
    caseType: 'complaints',
    caseId: '1',
    caseReference: 'CR-1',
    action: 'reassign',
    reason: 'Reviewer on leave.',
    changes: [],
    outcome: /** @type {const} */ ('recorded'),
    relatesTo: null,
    createdAt: '2026-10-01T09:15:00Z',
    createdBy: 'Robin Maintainer',
    ...overrides,
  };
}

/** @param {any[]} entries */
function loadedLogView(entries) {
  const slice = createRouteSlice(
    { caseType: 'complaints', id: '1', queryString: '' },
    context()
  );
  const state = replay(slice, [
    { type: 'case-support/case-loaded', row: makeCaseRow({ id: '1' }) },
    { type: 'case-support/log-loaded', entries },
  ]);
  const log = viewOf(slice, state).querySelector('.cora-case-support-log');
  assert.ok(log);
  return log;
}

test("case support log: the selected Case's own log is read", async () => {
  /** @type {any[]} */
  const asked = [];
  const entries = [logEntry()];
  const ctx = context({
    client: {
      getCase: async () => makeCaseRow({ id: '42' }),
      listSupportLog: async (/** @type {any} */ subject) => {
        asked.push(subject);
        return entries;
      },
    },
  });
  const slice = createRouteSlice(
    { caseType: 'example-review', id: '42', queryString: '' },
    ctx
  );
  /** @type {any[]} */
  const actions = [];
  slice.start(startTools(ctx, actions));
  await flush();

  assert.deepEqual(asked, [{ caseType: 'example-review', caseId: '42' }]);
  assert.ok(
    actions.some(
      (action) =>
        action.type === 'case-support/log-loaded' && action.entries === entries
    )
  );
});

test('case support log: each entry says what was done, by whom, when, why and to what', () => {
  const log = loadedLogView([
    logEntry({
      changes: [
        { field: 'assignedReviewer', before: 'user-a', after: 'user-b' },
        { field: 'awaitingSince', before: '2026-09-20', after: null },
        { field: 'awaitingResponsibleParty', before: true, after: false },
      ],
    }),
  ]);

  const text = log.textContent;
  assert.match(text, /Reassign/, 'the action is named by its title');
  assert.match(text, /Robin Maintainer, 1 Oct 2026/);
  assert.match(text, /Reviewer on leave\./);
  assert.match(text, /assignedReviewer: user-a → user-b/);
  assert.match(text, /awaitingSince: 2026-09-20 → —/);
  assert.match(text, /awaitingResponsibleParty: true → false/);
  assert.doesNotMatch(text, /Not applied/);
});

test('case support log: an action whose Case write failed is marked not applied', () => {
  const log = loadedLogView([
    logEntry({ id: '2', outcome: 'not-applied', relatesTo: '1' }),
    logEntry({ id: '1' }),
  ]);
  const items = log.querySelectorAll('li.cora-case-support-log-entry');
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /Not applied/);
  assert.doesNotMatch(items[1].textContent, /Not applied/);
});

test('case support log: an action the page does not know is shown by its stored name', () => {
  const log = loadedLogView([
    logEntry({ action: 'retired-action', createdBy: '' }),
  ]);
  assert.match(log.textContent, /retired-action/);
  assert.match(log.textContent, /Unknown, /);
});

test('case support log: a Case with no support history says so', () => {
  assert.match(
    loadedLogView([]).textContent,
    /No support actions have been recorded on this Case/
  );
});

test('case support log: a log that cannot be read is reported in its own panel', async () => {
  const ctx = context({
    client: {
      getCase: async () => makeCaseRow({ id: '1', title: 'CR-1' }),
      listSupportLog: async () => {
        throw new Error('list missing');
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

  const view = viewOf(slice, replay(slice, actions));
  assert.ok(
    getByRole(view, 'heading', { name: 'CR-1' }),
    'the Case is still shown'
  );
  const log = /** @type {any} */ (view.querySelector('.cora-case-support-log'));
  assert.match(
    getByRole(log, 'alert').textContent,
    /support log could not be loaded.*list missing/
  );
});

test('case support log: shows a loading placeholder until it is read', () => {
  const slice = createRouteSlice(
    { caseType: 'complaints', id: '1', queryString: '' },
    context()
  );
  const state = slice.reducer(slice.initialState, {
    type: 'case-support/case-loaded',
    row: makeCaseRow({ id: '1' }),
  });
  const log = /** @type {any} */ (
    viewOf(slice, state).querySelector('.cora-case-support-log')
  );
  assert.ok(log.querySelector('.cora-loading'));
});

test('case support log: an unknown Case Type asks for no log', async () => {
  let asked = false;
  const ctx = context({
    client: {
      getCase: async () => null,
      listSupportLog: async () => {
        asked = true;
        return [];
      },
    },
  });
  const slice = createRouteSlice(
    { caseType: 'nope', id: '1', queryString: '' },
    ctx
  );
  slice.start(startTools(ctx, []));
  await flush();
  assert.equal(asked, false);
});

/**
 * A started Case Support page over a mock tenant, with a real dispatch loop.
 *
 * @param {{ row?: Record<string, unknown>, people?: any[], supportLog?: any[] }} [setup]
 */
function live(setup = {}) {
  const client = new MockSharePointClient({
    personas: { maintainer: { groups: [], displayName: 'Robin Maintainer' } },
    persona: 'maintainer',
    lists: {
      'Cases-Complaints': [
        makeCaseRow({
          id: '1',
          title: 'CR-1',
          assignedReviewer: 'zara',
          assignedReviewerManager: 'old-manager',
          ...setup.row,
        }),
      ],
    },
    people: setup.people ?? [
      {
        loginName: 'zara',
        displayName: 'Zara',
        groups: ['Reviewers - Complaints'],
      },
      {
        loginName: 'bea',
        displayName: 'Bea',
        manager: 'i:0#.w|CONTOSO\\Mo',
        groups: ['Reviewers - Complaints'],
      },
      {
        loginName: 'amir',
        displayName: 'Amir',
        groups: ['Reviewers - Complaints'],
      },
      {
        loginName: 'other',
        displayName: 'Other',
        groups: ['Reviewers - Example Review'],
      },
    ],
    supportLog: setup.supportLog ?? [],
    now: () => new Date('2026-10-05T12:00:00Z'),
  });
  const ctx = context({ client: null });
  ctx.client = client;
  const slice = createRouteSlice(
    { caseType: 'complaints', id: '1', queryString: '' },
    ctx,
    { now: () => new Date('2026-10-05T12:00:00Z') }
  );
  let state = slice.initialState;
  const dispatch = (/** @type {any} */ action) => {
    state = slice.reducer(state, action);
  };
  slice.start(startTools(ctx, [], { dispatch }));
  dispatch({
    type: 'case-support/case-loaded',
    row: makeCaseRow({
      id: '1',
      title: 'CR-1',
      assignedReviewer: 'zara',
      assignedReviewerManager: 'old-manager',
      ...setup.row,
    }),
  });
  return {
    client,
    dispatch,
    state: () => state,
    view: () => slice.view(state, { dispatch }),
  };
}

/** @param {ReturnType<typeof live>} page */
async function openReassign(page) {
  fireEvent(getByRole(page.view(), 'button', { name: 'Reassign' }), 'click');
  await flush();
}

/** @param {ReturnType<typeof live>} page @param {string} name @param {string} reason */
function fillReassign(page, name, reason) {
  const label = [
    ...page.view().querySelectorAll('.cora-case-support-candidate'),
  ].find((candidate) => candidate.textContent === name);
  assert.ok(label, `${name} is offered`);
  fireEvent(label.querySelector('input'), 'change');
  const textarea = page.view().querySelector('textarea');
  fireEvent(textarea, 'input', { target: { value: reason } });
}

test('reassign: the candidates are the Case Type reviewer group, less the current Reviewer', async () => {
  const page = live();
  await openReassign(page);

  const offered = [
    ...page.view().querySelectorAll('.cora-case-support-candidate'),
  ].map((label) => label.textContent);
  assert.deepEqual(offered, ['Amir', 'Bea']);
  assert.match(page.view().textContent, /from Reviewers - Complaints/);
});

test('reassign: it cannot be submitted without both a Reviewer and a reason', async () => {
  const page = live();
  await openReassign(page);
  const submit = () =>
    getByRole(page.view(), 'button', { name: 'Reassign' }).disabled;

  assert.equal(submit(), true);
  fillReassign(page, 'Bea', '   ');
  assert.equal(submit(), true, 'a blank reason is no reason');
  fillReassign(page, 'Bea', 'Zara is on leave.');
  assert.equal(submit(), false);
});

test('reassign: the log is written first, then the Reviewer and manager change in one write', async () => {
  const page = live();
  /** @type {string[]} */
  const order = [];
  const addEntry = page.client.addSupportLogEntry.bind(page.client);
  const patch = page.client.patchCase.bind(page.client);
  page.client.addSupportLogEntry = async (entry) => {
    order.push(`log:${entry.outcome}`);
    return addEntry(entry);
  };
  /** @type {any[]} */
  const writes = [];
  page.client.patchCase = async (...args) => {
    order.push('patch');
    writes.push(args);
    return patch(...args);
  };
  await openReassign(page);
  fillReassign(page, 'Bea', 'Zara is on leave.');

  fireEvent(getByRole(page.view(), 'button', { name: 'Reassign' }), 'click');
  await flush(60);

  assert.deepEqual(order, ['log:recorded', 'patch']);
  const [[id, fields, etag, opts]] = writes;
  assert.equal(id, '1');
  assert.deepEqual(fields, {
    assignedReviewer: 'bea',
    assignedReviewerManager: 'mo',
  });
  assert.equal(etag, 'etag-1');
  assert.equal(opts.listName, 'Cases-Complaints');

  const stored = await page.client.getCase('1', {
    listName: 'Cases-Complaints',
  });
  assert.equal(stored?.assignedReviewer, 'bea');
  assert.equal(stored?.assignedAt, '2026-10-05T12:00:00.000Z');
  const [entry] = await page.client.listSupportLog({
    caseType: 'complaints',
    caseId: '1',
  });
  assert.equal(entry.action, 'reassign');
  assert.equal(entry.reason, 'Zara is on leave.');
  assert.equal(entry.caseReference, 'CR-1');
  assert.deepEqual(entry.changes, [
    { field: 'assignedReviewer', before: 'zara', after: 'bea' },
    { field: 'assignedReviewerManager', before: 'old-manager', after: 'mo' },
  ]);

  const view = page.view();
  assert.equal(getByRole(view, 'status').textContent, 'Reassigned to Bea.');
  assert.equal(definitionFor(view, 'Assigned Reviewer').textContent, 'bea');
  assert.ok(
    view.querySelector('.cora-case-support-log-entry'),
    'the log is re-read'
  );
  assert.equal(view.querySelector('textarea'), null, 'the form has closed');
});

test('reassign: a Case changed since it was opened is not overwritten, and the log says so', async () => {
  const page = live();
  await openReassign(page);
  fillReassign(page, 'Amir', 'Rebalancing.');
  page.client.inject412();

  fireEvent(getByRole(page.view(), 'button', { name: 'Reassign' }), 'click');
  await flush(60);

  const stored = await page.client.getCase('1', {
    listName: 'Cases-Complaints',
  });
  assert.equal(stored?.assignedReviewer, 'zara');
  const [failed, recorded] = await page.client.listSupportLog({
    caseType: 'complaints',
    caseId: '1',
  });
  assert.equal(recorded.outcome, 'recorded');
  assert.equal(failed.outcome, 'not-applied');
  assert.equal(failed.relatesTo, recorded.id);
  assert.match(
    getByRole(page.view(), 'alert').textContent,
    /changed after it was opened.*Reload/
  );
  assert.ok(page.view().querySelector('textarea'), 'the form stays open');
});

test('reassign: a support log that cannot be written leaves the Case untouched', async () => {
  const page = live();
  let patched = false;
  page.client.addSupportLogEntry = async () => {
    throw new Error('HTTP 403');
  };
  page.client.patchCase = async () => {
    patched = true;
    return { ok: true, status: 200 };
  };
  await openReassign(page);
  fillReassign(page, 'Amir', 'Rebalancing.');

  fireEvent(getByRole(page.view(), 'button', { name: 'Reassign' }), 'click');
  await flush(60);

  assert.equal(patched, false);
  assert.match(
    getByRole(page.view(), 'alert').textContent,
    /Nothing was changed.*HTTP 403/
  );
});

test('reassign: an unreadable reviewer group is reported in the form', async () => {
  const page = live();
  page.client.listGroupMembers = async () => {
    throw new Error('HTTP 404');
  };
  await openReassign(page);

  assert.match(
    getByRole(page.view(), 'alert').textContent,
    /reviewer group could not be read.*HTTP 404/
  );
});

test('reassign: a group with nobody else in it says so, and cancel returns to the actions', async () => {
  const page = live({
    people: [
      {
        loginName: 'zara',
        displayName: 'Zara',
        groups: ['Reviewers - Complaints'],
      },
    ],
  });
  await openReassign(page);
  assert.match(
    page.view().textContent,
    /Nobody else is in Reviewers - Complaints/
  );

  fireEvent(getByRole(page.view(), 'button', { name: 'Cancel' }), 'click');
  assert.ok(getByRole(page.view(), 'heading', { name: 'Support actions' }));
});

test('reassign: a Case with no Reviewer, or a Void one, cannot be reassigned', () => {
  for (const row of [
    { status: CASE_STATUS.TO_ALLOCATE, assignedReviewer: '' },
    { status: CASE_STATUS.VOID },
  ]) {
    const page = live({ row });
    const button = getByRole(page.view(), 'button', { name: 'Reassign' });
    assert.equal(button.disabled, true, row.status);
    assert.ok(
      page.view().querySelector('.cora-case-support-action-blocked'),
      row.status
    );
  }
});

test('reassign: shows a placeholder while the reviewer group is read', () => {
  const page = live();
  page.dispatch({ type: 'case-support/reassign-opened' });
  assert.ok(page.view().querySelector('.cora-loading'));
});

test('reassign: while saving, the form cannot be changed or sent twice', async () => {
  const page = live();
  await openReassign(page);
  fillReassign(page, 'Bea', 'On leave.');
  page.dispatch({ type: 'case-support/reassign-saving' });

  const view = page.view();
  assert.equal(
    getByRole(view, 'button', { name: 'Reassigning…' }).disabled,
    true
  );
  assert.equal(getByRole(view, 'button', { name: 'Cancel' }).disabled, true);
  assert.equal(view.querySelector('textarea')?.disabled, true);
});

test('reassign: a failed save that is not a conflict says why, without asking for a reload', async () => {
  const page = live();
  await openReassign(page);
  fillReassign(page, 'Amir', 'Rebalancing.');
  page.client.patchCase = async () => ({ ok: false, status: 500 });

  fireEvent(getByRole(page.view(), 'button', { name: 'Reassign' }), 'click');
  await flush(60);

  const alert = getByRole(page.view(), 'alert').textContent;
  assert.match(alert, /status 500/);
  assert.doesNotMatch(alert, /Reload/);
});

test('reassign: an action the form does not handle leaves it as it was', async () => {
  const page = live();
  await openReassign(page);
  const before = page.state();
  page.dispatch({ type: 'case-support/unrelated' });
  assert.strictEqual(
    page.state().routes.caseSupport.selected?.reassign,
    before.routes.caseSupport.selected?.reassign
  );
});

/** @param {ReturnType<typeof live>} page @param {string} reason */
function unassign(page, reason) {
  fireEvent(getByRole(page.view(), 'button', { name: 'Un-assign' }), 'click');
  fireEvent(page.view().querySelector('textarea'), 'input', {
    target: { value: reason },
  });
}

const HELD = {
  dueDate: '2026-10-09T00:00:00.000Z',
  onHold: true,
  placedOnHoldAt: '2026-10-02T09:00:00.000Z',
};

test('un-assign: it cannot be sent without a reason, and says what it clears', () => {
  const page = live();
  fireEvent(getByRole(page.view(), 'button', { name: 'Un-assign' }), 'click');
  const submit = () =>
    getByRole(page.view(), 'button', { name: 'Un-assign' }).disabled;

  assert.ok(getByRole(page.view(), 'heading', { name: 'Un-assign the Case' }));
  assert.match(
    page.view().textContent,
    /leaves zara and returns to To-allocate/
  );
  assert.equal(submit(), true);
  fireEvent(page.view().querySelector('textarea'), 'input', {
    target: { value: '  ' },
  });
  assert.equal(submit(), true, 'a blank reason is no reason');
  fireEvent(page.view().querySelector('textarea'), 'input', {
    target: { value: 'Zara has left.' },
  });
  assert.equal(submit(), false);
});

test('un-assign: the log is written first, then the Case returns to the pot in one write', async () => {
  const page = live({ row: HELD });
  await page.client.patchCase('1', HELD, 'etag-1', {
    listName: 'Cases-Complaints',
  });
  const opened = await page.client.getCase('1', {
    listName: 'Cases-Complaints',
  });
  page.dispatch({ type: 'case-support/case-loaded', row: opened });
  /** @type {string[]} */
  const order = [];
  const addEntry = page.client.addSupportLogEntry.bind(page.client);
  const patch = page.client.patchCase.bind(page.client);
  page.client.addSupportLogEntry = async (entry) => {
    order.push(`log:${entry.outcome}`);
    return addEntry(entry);
  };
  page.client.patchCase = async (...args) => {
    order.push('patch');
    return patch(...args);
  };
  unassign(page, 'Zara has left.');

  fireEvent(getByRole(page.view(), 'button', { name: 'Un-assign' }), 'click');
  await flush(60);

  assert.deepEqual(order, ['log:recorded', 'patch']);
  const stored = await page.client.getCase('1', {
    listName: 'Cases-Complaints',
  });
  assert.equal(stored?.status, CASE_STATUS.TO_ALLOCATE);
  assert.equal(stored?.assignedReviewer, '');
  assert.equal(stored?.assignedAt, null);
  assert.equal(stored?.assignedReviewerManager, null);
  assert.equal(stored?.dueDate, null);
  assert.equal(stored?.onHold, false);
  assert.deepEqual(stored?.answers, opened?.answers, 'Answers are kept');

  const [entry] = await page.client.listSupportLog({
    caseType: 'complaints',
    caseId: '1',
  });
  assert.equal(entry.action, 'unassign');
  assert.equal(entry.reason, 'Zara has left.');
  assert.deepEqual(entry.changes, [
    { field: 'status', before: 'In-progress', after: 'To-allocate' },
    { field: 'assignedReviewer', before: 'zara', after: '' },
    { field: 'assignedReviewerManager', before: 'old-manager', after: null },
    { field: 'dueDate', before: HELD.dueDate, after: null },
    { field: 'onHold', before: true, after: false },
    { field: 'placedOnHoldAt', before: HELD.placedOnHoldAt, after: null },
    { field: 'assignedAt', before: opened?.assignedAt, after: null },
  ]);

  const view = page.view();
  assert.match(getByRole(view, 'status').textContent, /back in To-allocate/);
  assert.equal(definitionFor(view, 'Status').textContent, 'To-allocate');
  assert.equal(view.querySelector('textarea'), null, 'the form has closed');
});

test('un-assign: a released Case can be claimed from the pot again', async () => {
  const page = live();
  unassign(page, 'Rebalancing.');
  fireEvent(getByRole(page.view(), 'button', { name: 'Un-assign' }), 'click');
  await flush(60);

  const [pot] = await page.client.listCases(
    { status: CASE_STATUS.TO_ALLOCATE },
    { listName: 'Cases-Complaints' }
  );
  assert.equal(pot?.id, '1');
  assert.equal(pot?.assignedReviewer, '');
});

test('un-assign: a Case changed since it was opened is left alone, and the log says so', async () => {
  const page = live();
  unassign(page, 'Rebalancing.');
  page.client.inject412();

  fireEvent(getByRole(page.view(), 'button', { name: 'Un-assign' }), 'click');
  await flush(60);

  const stored = await page.client.getCase('1', {
    listName: 'Cases-Complaints',
  });
  assert.equal(stored?.status, CASE_STATUS.IN_PROGRESS);
  const [failed, recorded] = await page.client.listSupportLog({
    caseType: 'complaints',
    caseId: '1',
  });
  assert.equal(failed.outcome, 'not-applied');
  assert.equal(failed.relatesTo, recorded.id);
  assert.match(
    getByRole(page.view(), 'alert').textContent,
    /changed after it was opened.*Reload/
  );
});

test('un-assign: a support log that cannot be written leaves the Case untouched', async () => {
  const page = live();
  let patched = false;
  page.client.addSupportLogEntry = async () => {
    throw new Error('HTTP 403');
  };
  page.client.patchCase = async () => {
    patched = true;
    return { ok: true, status: 200 };
  };
  unassign(page, 'Rebalancing.');

  fireEvent(getByRole(page.view(), 'button', { name: 'Un-assign' }), 'click');
  await flush(60);

  assert.equal(patched, false);
  assert.match(
    getByRole(page.view(), 'alert').textContent,
    /Nothing was changed.*HTTP 403/
  );
});

test('un-assign: only an In-progress Case can be un-assigned', () => {
  for (const status of [
    CASE_STATUS.TO_ALLOCATE,
    CASE_STATUS.ACTIONS_IN_PROGRESS,
    CASE_STATUS.COMPLETED,
    CASE_STATUS.VOID,
  ]) {
    const page = live({ row: { status } });
    const button = getByRole(page.view(), 'button', { name: 'Un-assign' });
    assert.equal(button.disabled, true, status);
  }
  const waiting = live({ row: { status: CASE_STATUS.TO_ALLOCATE } });
  assert.match(waiting.view().textContent, /already waiting to be claimed/);
});

test('un-assign: while saving the form is locked, and cancel returns to the actions', () => {
  const page = live();
  unassign(page, 'On leave.');
  page.dispatch({ type: 'case-support/unassign-saving' });
  const view = page.view();
  assert.equal(
    getByRole(view, 'button', { name: 'Un-assigning…' }).disabled,
    true
  );
  assert.equal(view.querySelector('textarea')?.disabled, true);

  page.dispatch({ type: 'case-support/unassign-failed', message: 'No.' });
  fireEvent(getByRole(page.view(), 'button', { name: 'Cancel' }), 'click');
  assert.ok(getByRole(page.view(), 'heading', { name: 'Support actions' }));
});

test('un-assign: an action the form does not handle leaves it as it was', () => {
  const page = live();
  unassign(page, 'On leave.');
  const before = page.state().routes.caseSupport.selected?.unassign;
  page.dispatch({ type: 'case-support/unrelated' });
  assert.strictEqual(
    page.state().routes.caseSupport.selected?.unassign,
    before
  );
});

const REPORTED = {
  status: CASE_STATUS.COMPLETED,
  reportableAt: '2026-10-01T09:00:00.000Z',
  completedAt: '2026-10-01T09:00:00.000Z',
  outcomeAtCompletion: 'fail',
  hadRemediation: true,
  effectiveOutcome: 'fail',
  effectiveHadRemediation: true,
  outcomeOverridden: false,
  questionBankVersion: 'v1',
  remediationDueDate: '2026-10-08',
  dueDate: '2026-10-05',
  answers: { q1: { value: 'No' } },
};

/** @param {ReturnType<typeof live>} page */
function startReopen(page) {
  fireEvent(getByRole(page.view(), 'button', { name: 'Reopen' }), 'click');
}

/** @param {ReturnType<typeof live>} page @param {string} reason */
function reopen(page, reason) {
  startReopen(page);
  fireEvent(page.view().querySelector('textarea'), 'input', {
    target: { value: reason },
  });
}

/** @param {ReturnType<typeof live>} page */
async function submitReopen(page) {
  fireEvent(getByRole(page.view(), 'button', { name: 'Reopen' }), 'click');
  await flush(60);
}

/** @param {ReturnType<typeof live>} page */
async function storedCase(page) {
  return page.client.getCase('1', { listName: 'Cases-Complaints' });
}

/**
 * Write fields the way a Case would have come to hold them, then show the page that stored row.
 *
 * @param {ReturnType<typeof live>} page
 * @param {Record<string, unknown>} fields
 */
async function holdStored(page, fields) {
  await page.client.patchCase('1', /** @type {any} */ (fields), 'etag-1', {
    listName: 'Cases-Complaints',
  });
  page.dispatch({
    type: 'case-support/case-loaded',
    row: await storedCase(page),
  });
}

test('reopen: it cannot be sent without a reason, and lists what it will do to this Case', () => {
  const page = live({ row: REPORTED });
  startReopen(page);
  const submit = () =>
    getByRole(page.view(), 'button', { name: 'Reopen' }).disabled;

  assert.ok(getByRole(page.view(), 'heading', { name: 'Reopen the Case' }));
  const text = page.view().textContent;
  assert.match(text, /returns to In-progress with zara/);
  assert.match(text, /Outcome are cleared, and kept in the Support Log/);
  assert.match(text, /Answer and remediation status is kept/);
  assert.match(text, /Due Date restarts at 12\/10\/2026/);
  assert.match(text, /stays at the version the Case was reviewed against/);
  assert.match(text, /leaves the completed counts in reports/);
  assert.doesNotMatch(text, /Amended Outcome/);
  assert.equal(submit(), true);
  fireEvent(page.view().querySelector('textarea'), 'input', {
    target: { value: '  ' },
  });
  assert.equal(submit(), true, 'a blank reason is no reason');
  fireEvent(page.view().querySelector('textarea'), 'input', {
    target: { value: 'Wrong Outcome.' },
  });
  assert.equal(submit(), false);
});

test('reopen: the preview names a cleared Amended Outcome and a Case with no recorded bank version', () => {
  const page = live({
    row: {
      ...REPORTED,
      questionBankVersion: undefined,
      amendedOutcome: {
        outcome: 'pass',
        justification: 'Corrected.',
        amendedBy: 'controls',
        amendedAt: '2026-10-02T09:00:00.000Z',
      },
    },
  });
  startReopen(page);

  const text = page.view().textContent;
  assert.match(text, /Amended Outcome is cleared too.*amend it again/);
  assert.match(text, /before Question Bank versions were recorded/);
});

test('reopen: the log is written first, then the Case goes back to In-progress in one write', async () => {
  const page = live({ row: REPORTED });
  await holdStored(page, {
    ...REPORTED,
    awaitingResponsibleParty: true,
    awaitingSince: '2026-10-01T09:00:00.000Z',
  });
  const opened = await storedCase(page);
  /** @type {string[]} */
  const order = [];
  const addEntry = page.client.addSupportLogEntry.bind(page.client);
  const patch = page.client.patchCase.bind(page.client);
  page.client.addSupportLogEntry = async (entry) => {
    order.push(`log:${entry.outcome}`);
    return addEntry(entry);
  };
  /** @type {any[]} */
  const patches = [];
  page.client.patchCase = async (...args) => {
    order.push('patch');
    patches.push(args);
    return patch(...args);
  };
  reopen(page, 'Wrong Outcome.');

  await submitReopen(page);

  assert.deepEqual(order, ['log:recorded', 'patch']);
  assert.equal(patches.length, 1, 'one guarded write');
  assert.equal(patches[0][2], opened?.etag, 'under the etag it was read at');
  const stored = await storedCase(page);
  assert.equal(stored?.status, CASE_STATUS.IN_PROGRESS);
  assert.equal(stored?.assignedReviewer, 'zara');
  assert.deepEqual(stored?.answers, REPORTED.answers, 'Answers are kept');
  for (const cleared of [
    'reportableAt',
    'completedAt',
    'outcomeAtCompletion',
    'hadRemediation',
    'effectiveOutcome',
    'effectiveHadRemediation',
    'outcomeOverridden',
    'amendedOutcome',
    'remediationDueDate',
  ]) {
    assert.equal(
      /** @type {any} */ (stored)?.[cleared],
      null,
      `${cleared} is cleared`
    );
  }
  assert.equal(stored?.questionBankVersion, 'v1', 'the pinned version stays');
  assert.equal(stored?.dueDate, '2026-10-12');
  assert.equal(stored?.awaitingResponsibleParty, false);

  const [entry] = await page.client.listSupportLog({
    caseType: 'complaints',
    caseId: '1',
  });
  assert.equal(entry.action, 'reopen');
  assert.equal(entry.reason, 'Wrong Outcome.');
  const logged = entry.changes.map((change) => change.field);
  for (const field of [
    'status',
    'reportableAt',
    'completedAt',
    'outcomeAtCompletion',
    'hadRemediation',
    'dueDate',
    'awaitingResponsibleParty',
  ]) {
    assert.ok(logged.includes(field), `${field} is in the log`);
  }
  assert.deepEqual(
    entry.changes.find((change) => change.field === 'status'),
    { field: 'status', before: 'Completed', after: 'In-progress' }
  );
  assert.deepEqual(
    entry.changes.find((change) => change.field === 'hadRemediation'),
    { field: 'hadRemediation', before: true, after: null }
  );
  assert.deepEqual(
    entry.changes.find((change) => change.field === 'completedAt'),
    { field: 'completedAt', before: REPORTED.completedAt, after: null },
    'the log is the record of the completion the reopen cleared'
  );

  const view = page.view();
  assert.match(
    getByRole(view, 'status').textContent,
    /Reopened: the Case is back In-progress with zara\./
  );
  assert.equal(definitionFor(view, 'Status').textContent, 'In-progress');
  assert.equal(view.querySelector('textarea'), null, 'the form has closed');
});

test('reopen: a reopened Case is not offered to be reopened again', async () => {
  const page = live({ row: REPORTED });
  reopen(page, 'Wrong Outcome.');
  await submitReopen(page);

  const button = getByRole(page.view(), 'button', { name: 'Reopen' });
  assert.equal(button.disabled, true);
  assert.match(page.view().textContent, /Only a Completed Case/);
});

test('reopen: a Case that changed since it was opened is left alone, and the log says so', async () => {
  const page = live({ row: REPORTED });
  reopen(page, 'Wrong Outcome.');
  page.client.inject412();

  await submitReopen(page);

  const stored = await storedCase(page);
  assert.equal(stored?.status, CASE_STATUS.COMPLETED);
  const [failed, recorded] = await page.client.listSupportLog({
    caseType: 'complaints',
    caseId: '1',
  });
  assert.equal(failed.outcome, 'not-applied');
  assert.equal(failed.relatesTo, recorded.id);
  assert.match(
    getByRole(page.view(), 'alert').textContent,
    /changed after it was opened.*Reload/
  );
});

test('reopen: a support log that cannot be written leaves the Case untouched', async () => {
  const page = live({ row: REPORTED });
  let patched = false;
  page.client.addSupportLogEntry = async () => {
    throw new Error('HTTP 403');
  };
  page.client.patchCase = async () => {
    patched = true;
    return { ok: true, status: 200 };
  };
  reopen(page, 'Wrong Outcome.');

  await submitReopen(page);

  assert.equal(patched, false);
  assert.match(
    getByRole(page.view(), 'alert').textContent,
    /Nothing was changed.*HTTP 403/
  );
});

test('reopen: only a Completed Case without an open Appeal can be reopened, and the card says why not', () => {
  /** @type {Array<[Record<string, unknown>, RegExp | null]>} */
  const cases = [
    [{ status: CASE_STATUS.COMPLETED }, null],
    [
      { status: CASE_STATUS.ACTIONS_IN_PROGRESS },
      /still with the Responsible Party/,
    ],
    [{ status: CASE_STATUS.TO_ALLOCATE }, /Only a Completed Case/],
    [{ status: CASE_STATUS.IN_PROGRESS }, /Only a Completed Case/],
    [{ status: CASE_STATUS.VOID }, /Void Case cannot be reopened/],
    [
      {
        status: CASE_STATUS.COMPLETED,
        appeals: [{ id: 'a', state: 'underReview' }],
      },
      /open Appeal/,
    ],
    [
      {
        status: CASE_STATUS.COMPLETED,
        appeals: [{ id: 'a', state: 'resolved' }],
      },
      null,
    ],
  ];
  for (const [row, why] of cases) {
    const page = live({ row });
    const button = getByRole(page.view(), 'button', { name: 'Reopen' });
    const label = JSON.stringify(row);
    assert.equal(button.disabled, why !== null, label);
    if (why) assert.match(page.view().textContent, why, label);
  }
});

test('reopen: while saving the form is locked, and cancel returns to the actions', () => {
  const page = live({ row: REPORTED });
  reopen(page, 'Wrong Outcome.');
  page.dispatch({ type: 'case-support/reopen-saving' });
  const view = page.view();
  assert.equal(
    getByRole(view, 'button', { name: 'Reopening…' }).disabled,
    true
  );
  assert.equal(view.querySelector('textarea')?.disabled, true);

  page.dispatch({ type: 'case-support/reopen-failed', message: 'No.' });
  assert.equal(getByRole(page.view(), 'alert').textContent, 'No.');
  fireEvent(getByRole(page.view(), 'button', { name: 'Cancel' }), 'click');
  assert.ok(getByRole(page.view(), 'heading', { name: 'Support actions' }));
});

test('reopen: an action the form does not handle leaves it as it was', () => {
  const page = live({ row: REPORTED });
  reopen(page, 'Wrong Outcome.');
  const before = page.state().routes.caseSupport.selected?.reopen;
  page.dispatch({ type: 'case-support/unrelated' });
  assert.strictEqual(page.state().routes.caseSupport.selected?.reopen, before);
});

test('reopen: a Case Type with its own review SLA restarts the Due Date by it', async () => {
  const page = live({ row: REPORTED });
  const ctx = context({ client: null });
  ctx.client = page.client;
  ctx.caseSources = [{ ...SOURCES[0], reviewSlaWorkingDays: 1 }, SOURCES[1]];
  const slice = createRouteSlice(
    { caseType: 'complaints', id: '1', queryString: '' },
    ctx,
    { now: () => new Date('2026-10-05T12:00:00Z') }
  );
  let state = slice.initialState;
  const dispatch = (/** @type {any} */ action) => {
    state = slice.reducer(state, action);
  };
  slice.start(startTools(ctx, [], { dispatch }));
  dispatch({ type: 'case-support/case-loaded', row: await storedCase(page) });
  const view = () => slice.view(state, { dispatch });
  fireEvent(getByRole(view(), 'button', { name: 'Reopen' }), 'click');
  assert.match(view().textContent, /Due Date restarts at 06\/10\/2026/);
  fireEvent(view().querySelector('textarea'), 'input', {
    target: { value: 'Wrong Outcome.' },
  });
  fireEvent(getByRole(view(), 'button', { name: 'Reopen' }), 'click');
  await flush(60);

  assert.equal((await storedCase(page))?.dueDate, '2026-10-06');
});
