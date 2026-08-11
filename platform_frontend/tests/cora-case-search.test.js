// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole, tableHeaders } from './helpers/semantic-dom.js';
import { makeCaseRow, makeChrome } from './helpers/fixtures.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { createRouteSlice, caseSearchView } =
  await import('../src/pages/cora-case-search.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

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
    chrome: makeChrome({
      permissions: { isControls: true, canSearchCases: true },
    }),
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
    params: {},
    context: ctx,
    isActive: () => true,
    ...over,
  });
}

/** @param {any} slice @param {any} state */
function viewOf(slice, state, over = {}) {
  return slice.view(state, { dispatch: () => {}, ...over });
}

/** @param {string} id */
function row(id) {
  return makeCaseRow({ id, title: `CR-${id}`, etag: `e-${id}` });
}

/** @param {number} n */
async function flush(n = 20) {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

test('case search: with no filters the page prompts for one and issues no read', async () => {
  let searched = false;
  const ctx = context();
  const slice = createRouteSlice({ queryString: '' }, ctx, {
    searchCases: async () => {
      searched = true;
      return { rows: [], capped: false };
    },
  });

  slice.start?.(startTools(ctx, []));
  await flush();

  // A filterless query has no leading indexed predicate, so it is exactly the
  // query the List View Threshold refuses.
  assert.equal(searched, false, 'no read without a filter');

  const view = viewOf(slice, slice.initialState);
  assert.match(view.textContent, /Enter at least one filter to search/);
  assert.doesNotMatch(
    view.textContent,
    /No cases match/,
    'an unrun search has not found nothing — it has not been run'
  );
  assert.ok(
    view.querySelector('.cora-case-search-filters'),
    'the filter form is still offered'
  );
});

test('case search: results render the standard, framework-owned Case columns', () => {
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR' }, ctx);
  const loaded = slice.reducer(slice.initialState, {
    type: 'search/loaded',
    rows: [
      { ...row('c1'), overdue: true },
      { ...row('c2'), overdue: false },
    ],
    capped: false,
  });

  const view = viewOf(slice, loaded);
  assert.deepEqual(tableHeaders(view), [
    ['Reference', 'cora-col-reference', 'none', true],
    ['Case Type', 'cora-col-caseType', 'none', true],
    ['Related Date', 'cora-col-relatedDate', 'none', true],
    ['Due Date', 'cora-col-dueDate', 'none', true],
    ['Status', 'cora-col-status', 'none', true],
    ['Assigned', 'cora-col-assigned', 'none', true],
    ['Responsible Party', 'cora-col-responsibleParty', 'none', true],
    ['Actions', 'cora-col-actions', 'none', false],
  ]);
  assert.deepEqual(
    [...(view.querySelector('tbody')?.querySelectorAll('tr') ?? [])].map(
      (tableRow) => tableRow.className
    ),
    ['cora-case-row cora-case-row--overdue', 'cora-case-row']
  );
  assert.doesNotMatch(view.textContent, /narrow your filters/);

  location.hash = '';
  getByRole(view, 'button', { name: 'Open CR-c1' }).dispatchEvent(
    /** @type {any} */ ({ type: 'click' })
  );
  assert.equal(location.hash, '#/case/complaints/c1');
});

test('case search: a saturated result names the limit and asks for narrower filters', () => {
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR' }, ctx);
  const loaded = slice.reducer(slice.initialState, {
    type: 'search/loaded',
    rows: [row('c1')],
    capped: true,
  });

  const cap = viewOf(slice, loaded).querySelector('.cora-case-search-cap');
  assert.ok(cap, 'a capped result is announced in the page');
  assert.match(cap.textContent, /50/);
  assert.match(cap.textContent, /narrow your filters/);
});

test('case search: in flight shows the shared loading placeholder, no matches the shared empty one', () => {
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR' }, ctx);

  const loading = viewOf(slice, slice.initialState);
  assert.ok(loading.querySelector('.cora-loading'));

  const empty = viewOf(
    slice,
    slice.reducer(slice.initialState, {
      type: 'search/loaded',
      rows: [],
      capped: false,
    })
  );
  assert.ok(empty.querySelector('.cora-empty'));
  assert.equal(empty.querySelector('table'), null);
});

test('case search: submitting writes only the filled filters into the URL', () => {
  location.hash = '';
  const ctx = context();
  const slice = createRouteSlice({ queryString: '' }, ctx);

  let state = slice.initialState;
  for (const [key, value] of [
    ['titlePrefix', "CR-1/O'B"],
    ['reportableAfter', '2026-07-01'],
  ]) {
    state = slice.reducer(state, { type: 'search/filter-changed', key, value });
  }

  const filters = viewOf(slice, state).querySelector(
    '.cora-case-search-filters'
  );
  assert.ok(filters);
  assert.equal(
    filters.tagName.toLowerCase(),
    'div',
    'a form here would nest inside the host page form and post it back'
  );
  fireEvent(getByRole(filters, 'button', { name: 'Search' }), 'click');

  assert.equal(
    location.hash,
    '#/search?titlePrefix=CR-1%2FO%27B&reportableAfter=2026-07-01'
  );
});

test('case search: an emptied field contributes no key to the URL', () => {
  location.hash = '';
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR-1' }, ctx);

  const cleared = slice.reducer(slice.initialState, {
    type: 'search/filter-changed',
    key: 'titlePrefix',
    value: '',
  });
  const filters = viewOf(slice, cleared).querySelector(
    '.cora-case-search-filters'
  );
  fireEvent(getByRole(filters, 'button', { name: 'Search' }), 'click');

  assert.equal(location.hash, '#/search');
});

test('case search: Enter in a filter searches, without a form to submit', () => {
  location.hash = '';
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR-1' }, ctx);
  const filters = viewOf(slice, slice.initialState).querySelector(
    '.cora-case-search-filters'
  );
  assert.ok(filters);

  const pressed = fireEvent(filters, 'keydown', { key: 'Enter' });

  assert.equal(location.hash, '#/search?titlePrefix=CR-1');
  assert.equal(
    pressed.defaultPrevented,
    true,
    'the host page form must not post back'
  );
});

test('case search: a key other than Enter does not search', () => {
  location.hash = '';
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR-1' }, ctx);
  const filters = viewOf(slice, slice.initialState).querySelector(
    '.cora-case-search-filters'
  );

  fireEvent(/** @type {any} */ (filters), 'keydown', { key: 'a' });

  assert.equal(location.hash, '');
});

test('case search: Enter while the reviewer picker is offering matches is the pickers', () => {
  location.hash = '';
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR-1' }, ctx);
  const filters = viewOf(slice, slice.initialState).querySelector(
    '.cora-case-search-filters'
  );
  const combobox = getByRole(/** @type {any} */ (filters), 'combobox', {
    name: 'Assigned Reviewer',
  });

  fireEvent(/** @type {any} */ (filters), 'keydown', {
    key: 'Enter',
    target: combobox,
  });

  assert.equal(
    location.hash,
    '',
    'choosing a person must not also run the search'
  );
});

test('case search: the form is authored from state, so a restored URL refills it', () => {
  const ctx = context();
  const slice = createRouteSlice(
    {
      queryString:
        '?titlePrefix=CR-1&caseType=complaints&assignedReviewer=rev-a&reportableAfter=2026-07-01&reportableBefore=2026-07-08',
    },
    ctx
  );

  const values = [
    ...viewOf(slice, slice.initialState)
      .querySelector('.cora-case-search-filters')
      .querySelectorAll('input'),
  ].map((input) => input.value);

  assert.deepEqual(values, ['CR-1', 'rev-a', '2026-07-01', '2026-07-08']);
  assert.equal(
    viewOf(slice, slice.initialState).querySelector('select')?.value,
    'complaints'
  );
});

test('case search: reducer owns loaded rows, failure, and the table sort', () => {
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR' }, ctx);

  const loaded = slice.reducer(slice.initialState, {
    type: 'search/loaded',
    rows: [row('c1')],
    capped: true,
  });
  assert.equal(loaded.routes.caseSearch.rows?.length, 1);
  assert.equal(loaded.routes.caseSearch.capped, true);
  assert.strictEqual(loaded.chrome, slice.initialState.chrome);

  const failed = slice.reducer(loaded, {
    type: 'search/failed',
    message: 'nope',
  });
  assert.equal(failed.routes.caseSearch.error, 'nope');

  const sorted = slice.reducer(loaded, {
    type: 'search-table/sort-requested',
    key: 'reference',
  });
  assert.deepEqual(sorted.routes.caseSearch.sort, {
    key: 'reference',
    dir: 'asc',
  });

  assert.strictEqual(slice.reducer(loaded, { type: 'ignored' }), loaded);
});

test('case search: sorting a results table dispatches this table sort action', () => {
  /** @type {any[]} */
  const actions = [];
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR' }, ctx);
  const loaded = slice.reducer(slice.initialState, {
    type: 'search/loaded',
    rows: [row('c1')],
    capped: false,
  });

  const view = viewOf(slice, loaded, {
    dispatch: (/** @type {any} */ action) => actions.push(action),
  });
  view
    .querySelector('th')
    ?.querySelector('button')
    ?.dispatchEvent(/** @type {any} */ ({ type: 'click' }));

  assert.deepEqual(actions, [
    { type: 'search-table/sort-requested', key: 'reference' },
  ]);
});

test('case search: a URL carrying filters searches through the lifetime-bound client', async () => {
  /** @type {any[]} */
  const actions = [];
  /** @type {any[]} */
  const seen = [];
  const controller = new AbortController();
  const ctx = context({
    client: {
      /** @param {any} _filter @param {any} opts */
      listCases: (_filter, opts) => {
        seen.push(opts.signal);
        return Promise.resolve([]);
      },
    },
  });
  const rows = [row('c1')];
  const slice = createRouteSlice(
    { queryString: '?titlePrefix=CR-1&assignedReviewer=rev-a' },
    ctx,
    {
      searchCases: async (
        /** @type {any} */ client,
        /** @type {any} */ filter,
        /** @type {any} */ sources
      ) => {
        await client.listCases(filter, { listName: sources[0].listName });
        return { rows, capped: false };
      },
    }
  );

  slice.start?.(
    startTools(ctx, actions, { signal: controller.signal, params: {} })
  );
  await flush();

  assert.deepEqual(actions, [{ type: 'search/loaded', rows, capped: false }]);
  assert.deepEqual(
    seen,
    [controller.signal],
    'the read carries the mount lifetime, so navigating away cancels it'
  );
});

test('case search: the search is scoped by the filters parsed from the URL', async () => {
  /** @type {any[]} */
  const calls = [];
  const ctx = context();
  const slice = createRouteSlice(
    { queryString: '?titlePrefix=CR-1&caseType=complaints' },
    ctx,
    {
      searchCases: async (
        /** @type {any} */ _client,
        /** @type {any} */ filter,
        /** @type {any} */ sources
      ) => {
        calls.push({ filter, sources });
        return { rows: [], capped: false };
      },
    }
  );

  slice.start?.(startTools(ctx, []));
  await flush();

  assert.deepEqual(calls[0].filter, {
    titlePrefix: 'CR-1',
    caseType: 'complaints',
  });
  assert.equal(calls[0].sources, ctx.caseSources);

  // Every filter at once: an empty field contributes no key to the query, so a
  // filled one must, and each key has to survive the crossing into the client's
  // own vocabulary.
  const all = createRouteSlice(
    {
      queryString:
        '?titlePrefix=CR-1&caseType=complaints&assignedReviewer=rev-a' +
        '&reportableAfter=2026-07-01&reportableBefore=2026-07-08',
    },
    ctx,
    {
      searchCases: async (
        /** @type {any} */ _client,
        /** @type {any} */ filter
      ) => {
        calls.push({ filter, sources: null });
        return { rows: [], capped: false };
      },
    }
  );
  all.start?.(startTools(ctx, []));
  await flush();

  assert.deepEqual(calls[1].filter, {
    titlePrefix: 'CR-1',
    caseType: 'complaints',
    assignedReviewer: 'rev-a',
    reportableAfter: '2026-07-01',
    reportableBefore: '2026-07-08',
  });
});

test('case search: a hand-edited URL naming an unknown Case Type fails without a request', async () => {
  /** @type {any[]} */
  const actions = [];
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?caseType=made-up' }, ctx, {
    searchCases: async () => assert.fail('must not read for an unknown list'),
  });

  slice.start?.(startTools(ctx, actions));
  await flush();

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'search/failed');
  assert.match(actions[0].message, /made-up/);
});

test('case search: a failing read is reported in the page, beside the form that caused it', async () => {
  /** @type {any[]} */
  const actions = [];
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR-1' }, ctx, {
    searchCases: async () => {
      throw new Error('403 on one list');
    },
  });

  slice.start?.(startTools(ctx, actions));
  await flush();

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'search/failed');

  const failed = slice.reducer(slice.initialState, actions[0]);
  const view = viewOf(slice, failed);
  assert.ok(view.querySelector('.cora-case-search-error'));
  assert.ok(
    view.querySelector('.cora-case-search-filters'),
    'the filters stay correctable'
  );
});

test('case search: an aborted read is navigation, so it dispatches nothing', async () => {
  /** @type {any[]} */
  const actions = [];
  const ctx = context();
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR-1' }, ctx, {
    searchCases: async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    },
  });

  slice.start?.(startTools(ctx, actions));
  await flush();

  assert.deepEqual(actions, []);
});

test('case search: a result arriving after navigation is dropped', async () => {
  /** @type {any[]} */
  const actions = [];
  const ctx = context();
  let active = true;
  /** @type {(value: any) => void} */
  let resolveSearch = () => {};
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR-1' }, ctx, {
    searchCases: () =>
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
  });

  slice.start?.(startTools(ctx, actions, { isActive: () => active }));
  active = false;
  resolveSearch({ rows: [row('late')], capped: false });
  await flush();

  assert.deepEqual(actions, []);
});

test('case search: a client-less mount degrades rather than failing the route', () => {
  const ctx = context({ client: null });
  const slice = createRouteSlice({ queryString: '?titlePrefix=CR-1' }, ctx, {
    searchCases: () => assert.fail('must not read without a client'),
  });

  assert.doesNotThrow(() => slice.start?.(startTools(ctx, [])));
});

/**
 * Drive the page's Reviewer picker the way a user does: render the view through
 * the slice (so the debounced search behind `onQueryInput` is the real one),
 * type, and fold every action the store received back into the state.
 *
 * @param {{ searchPeople: (query: string) => Promise<any[]> }} directory
 */
function reviewerPicker(directory) {
  /** @type {any[]} */
  const actions = [];
  const ctx = context({ client: directory });
  const slice = createRouteSlice({ queryString: '' }, ctx, {});
  const cleanup = slice.start?.(startTools(ctx, actions));
  let state = slice.initialState;

  /** Re-render from the current state and return the picker's root. */
  const render = () => {
    const view = viewOf(slice, state, {
      dispatch: (/** @type {any} */ action) => {
        actions.push(action);
        apply();
      },
    });
    return view.querySelector('.cora-people-picker');
  };
  const apply = () => {
    for (const action of actions.splice(0))
      state = slice.reducer(state, action);
  };

  return {
    cleanup,
    apply,
    get state() {
      return state;
    },
    /** @param {string} value */
    type(value) {
      render().querySelector('input')._fire('input', { target: { value } });
      apply();
    },
    /** @param {any} action */
    dispatch(action) {
      state = slice.reducer(state, action);
    },
    options() {
      return [...render().querySelectorAll('.cora-people-picker-option')].map(
        (option) => option.textContent
      );
    },
    statusText() {
      return render().querySelector('.cora-people-picker-status').textContent;
    },
    select() {
      getByRole(render(), 'option', { name: /Reviewer A/ }).dispatchEvent(
        /** @type {any} */ ({ type: 'click' })
      );
      apply();
    },
  };
}

const REVIEWER_A = { loginName: 'rev-a', displayName: 'Reviewer A' };

test('case search: the Reviewer field resolves accounts through the directory and offers nothing else', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {Promise<any>[]} */
  const directoryCalls = [];
  const picker = reviewerPicker({
    searchPeople: () => {
      const pending = Promise.resolve([REVIEWER_A]);
      directoryCalls.push(pending);
      return pending;
    },
  });

  picker.type('rev');
  assert.equal(picker.state.routes.caseSearch.reviewerSearch.status, 'idle');
  assert.deepEqual(picker.options(), []);
  assert.equal(picker.statusText(), '');

  // Loading starts when the debounce expires, before the directory call settles.
  t.mock.timers.tick(200);
  picker.apply();
  assert.equal(picker.state.routes.caseSearch.reviewerSearch.status, 'loading');
  assert.deepEqual(picker.options(), []);
  assert.equal(picker.statusText(), 'Searching…');
  await Promise.all(directoryCalls);
  await flush();
  picker.apply();

  assert.equal(picker.state.routes.caseSearch.reviewerSearch.status, 'success');
  assert.deepEqual(picker.options(), ['Reviewer A — rev-a']);
  assert.equal(picker.statusText(), '');

  // An unresolvable account would make the whole query reject, so typed text is
  // never offered as one.
  picker.dispatch({
    type: 'search/reviewer-results',
    search: { query: 'rev', people: [], status: 'success' },
  });
  assert.deepEqual(picker.options(), []);
  assert.equal(picker.statusText(), 'No matches');

  picker.cleanup?.();
});

test('case search: the Reviewer keeps prior matches until the next search starts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {Promise<any>[]} */
  const directoryCalls = [];
  const picker = reviewerPicker({
    searchPeople: () => {
      const pending = Promise.resolve([REVIEWER_A]);
      directoryCalls.push(pending);
      return pending;
    },
  });

  picker.type('rev');
  t.mock.timers.tick(200);
  await Promise.all(directoryCalls);
  await flush();
  picker.apply();

  picker.type('reviewer');
  assert.equal(picker.state.routes.caseSearch.reviewerSearch.status, 'idle');
  assert.deepEqual(picker.options(), ['Reviewer A — rev-a']);

  t.mock.timers.tick(200);
  picker.apply();
  assert.equal(picker.state.routes.caseSearch.reviewerSearch.status, 'loading');
  assert.deepEqual(picker.options(), []);
  picker.cleanup?.();
});

test('case search: a Reviewer search that fails says so instead of reading as an empty directory', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {Promise<any>[]} */
  const directoryCalls = [];
  const picker = reviewerPicker({
    searchPeople: () => {
      const pending = Promise.reject(new Error('HTTP Error: 400'));
      directoryCalls.push(pending);
      return pending;
    },
  });

  picker.type('rev');
  t.mock.timers.tick(200);
  await Promise.allSettled(directoryCalls);
  await flush();
  picker.apply();

  assert.equal(picker.state.routes.caseSearch.reviewerSearch.status, 'error');
  assert.deepEqual(picker.options(), []);
  assert.equal(picker.statusText(), 'Directory search is unavailable');
  picker.cleanup?.();
});

test('case search: an outcome for a query the user has typed past is dropped', () => {
  const picker = reviewerPicker({ searchPeople: async () => [] });

  picker.dispatch({ type: 'search/reviewer-query', query: 'reviewer b' });
  const before = picker.state;
  picker.dispatch({
    type: 'search/reviewer-results',
    search: { query: 'rev', people: [REVIEWER_A], status: 'success' },
  });

  assert.equal(picker.state, before, 'a stale success must not latch matches');
  picker.cleanup?.();
});

test('case search: choosing a person fills the Reviewer filter and stops the picker talking', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {string[]} */
  const searches = [];
  const picker = reviewerPicker({
    searchPeople: async (query) => {
      searches.push(query);
      return [REVIEWER_A];
    },
  });

  picker.type('rev');
  picker.dispatch({
    type: 'search/reviewer-results',
    search: { query: 'rev', people: [REVIEWER_A], status: 'success' },
  });
  picker.select();

  assert.equal(
    picker.state.routes.caseSearch.filters.assignedReviewer,
    'rev-a'
  );
  // Neither a status message under the person just chosen, nor a request still
  // on its way to replace them.
  assert.equal(picker.state.routes.caseSearch.reviewerSearch.status, 'idle');
  assert.equal(picker.statusText(), '');
  t.mock.timers.tick(200);
  await flush();
  assert.deepEqual(searches, []);
  picker.cleanup?.();
});

test('case search view: renders the labelled filter form on its own', () => {
  const ctx = context();
  const slice = createRouteSlice({ queryString: '' }, ctx);
  const view = caseSearchView(slice.initialState, { dispatch: () => {} });

  assert.equal(
    view.querySelector('.cora-case-search-filters')?.tagName?.toLowerCase(),
    'div'
  );
  assert.deepEqual(
    [...view.querySelectorAll('label')].map(
      (label) => label.querySelector('span')?.textContent
    ),
    [
      'Case Reference',
      'Case Type',
      'Assigned Reviewer',
      'Reportable from',
      'Reportable before',
    ]
  );
  assert.deepEqual(
    [...view.querySelectorAll('option')].map((option) => option.textContent),
    ['Any Case Type', 'Complaints', 'Example Review']
  );
});

test('case search: editing a field updates only that filter, and typing unresolves the Reviewer', () => {
  /** @type {any[]} */
  const actions = [];
  const ctx = context();
  const slice = createRouteSlice(
    { queryString: '?assignedReviewer=rev-a' },
    ctx
  );
  const view = viewOf(slice, slice.initialState, {
    dispatch: (/** @type {any} */ action) => actions.push(action),
  });

  const [reference, , from, before] = [...view.querySelectorAll('input')];
  reference._fire('input', { target: { value: 'CR-1' } });
  from._fire('input', { target: { value: '2026-07-01' } });
  before._fire('input', { target: { value: '' } });
  view.querySelector('select')._fire('change', {
    target: { value: 'complaints' },
  });
  actions.push({ type: 'search/reviewer-query', query: 'somebody else' });

  const next = actions.reduce(
    (state, action) => slice.reducer(state, action),
    slice.initialState
  );
  assert.deepEqual(next.routes.caseSearch.filters, {
    titlePrefix: 'CR-1',
    caseType: 'complaints',
    // Typing past a chosen person leaves the filter unresolved: only a
    // directory match may fill it.
    assignedReviewer: '',
    reportableAfter: '2026-07-01',
    reportableBefore: '',
  });
  assert.equal(next.routes.caseSearch.reviewerSearch.query, 'somebody else');
});
