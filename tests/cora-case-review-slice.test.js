// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush, waitFor } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  queryAllByRole,
  queryAllByTag,
} from './helpers/semantic-dom.js';
import { registerCaseType } from '../case-types/manifest.js';
import { makeCaseRow, makeChrome } from './helpers/fixtures.js';

installDom();

// A second fixture Case Type whose config never arrives. `CaseLoader.load()`
// awaits `loadCaseTypeConfig(params.caseType)` before it reaches
// `client.getCase(params.id)`, so mounting with this slug parks the load at its
// first await: the loader — the one legitimate reader of the route param —
// never runs, and a test that supplies its own store state can assert on the
// route param without racing it. `getCurrentUser: () => never` cannot achieve
// this: it shares a `Promise.all` with `getCase`, which has already been
// called by then.
registerCaseType({
  slug: 'pending-config-review',
  displayName: 'Pending Config Review',
  importer: () => new Promise(() => {}),
});

const {
  caseReviewReducer,
  conversationPanelMode,
  createRouteSlice,
  createInitialCaseReviewState,
} = await import('../src/pages/cora-case-review.js');
const { caseDetailsView } =
  await import('../src/pages/cora-case-review/details-view.js');
const { createCaseReviewSaveEffect, observeSaveStatus } =
  await import('../src/pages/cora-case-review/case-actions.js');
const { SaveQueue } = await import('../src/services/save-queue.js');
const { render } = await import('../src/core/render.js');
const { default: exampleReviewConfig } =
  await import('./_example-review-case-type.js');
const { default: complaintsConfig } =
  await import('../case-types/complaints.js');
const { evaluateAccess, SECTIONS } =
  await import('../src/services/section-access.js');
const { resolveSectionLabels } = await import('../src/lib/section-labels.js');

/**
 * The radio a Reviewer clicks to answer a Question. Several Questions offer the
 * same option wording, so the Question's own fieldset scopes the lookup.
 *
 * @param {any} root
 * @param {string} questionId
 * @param {string} option
 */
function answerOption(root, questionId, option) {
  const fieldset = queryAllByTag(root, 'fieldset').find(
    (/** @type {any} */ element) => element.id === `cora-q-${questionId}`
  );
  assert.ok(fieldset, `${questionId} renders`);
  return getByRole(fieldset, 'radio', { name: option });
}

const chrome = makeChrome({
  currentUser: { id: 'u1', displayName: 'User 1' },
});

// `assignedReviewer` matches `chrome.currentUser.id`, which is what makes the
// default posture "the Assigned Reviewer is looking at their own Case".
const caseRow = makeCaseRow({
  id: 'c1',
  caseType: 'example-review',
  title: 'Config-driven Case',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  onHold: false,
  placedOnHoldAt: null,
  etag: 'e1',
  details: { customerName: 'Ada Lovelace', accountNumber: '' },
});

function snapshot() {
  const catalogue = [
    {
      id: 'q1',
      text: 'Question one',
      responseType: 'yes-no-na',
      deprecated: false,
    },
  ];
  return /** @type {any} */ ({
    loaded: true,
    error: null,
    accessDenied: false,
    caseRow,
    currentUser: chrome.currentUser,
    config: {
      detailFields: [
        { key: 'customerName', label: 'Customer name' },
        { key: 'accountNumber', label: 'Account number' },
      ],
      captureGroups: [],
      outcomeOptions: [
        { id: 'pass', wording: 'Compliant', severity: 0 },
        { id: 'fail', wording: 'Non-compliant', severity: 100 },
      ],
      computeOutcome: () => ({ outcome: 'pass' }),
    },
    catalogue,
    applicableQuestions: catalogue,
    answers: caseRow.answers,
    allAnswered: false,
    summarySections: ['details', 'questions', 'issues'],
    machine: null,
    exportHash: null,
    caseListOptions: {},
    access: {
      details: 'read-only',
      questions: 'edit',
      issues: 'edit',
      remediation: 'hidden',
      summary: 'read-only',
      notes: 'edit',
      conversation: 'edit',
      appealRequest: 'read-only',
      appealReview: 'read-only',
      amendOutcome: 'hidden',
    },
    sectionLabels: resolveSectionLabels(null),
  });
}

/**
 * A `tools.listen` that records the route's document-level handlers by event
 * type, so a test can invoke them directly.
 *
 * Keyed by type alone: two listeners of one type would silently overwrite. That
 * is fine today — the route registers exactly one `keydown` and one
 * `visibilitychange`.
 *
 * @param {Map<string, Function>} listeners
 */
function captureListeners(listeners) {
  return (
    /** @type {any} */ _target,
    /** @type {string} */ type,
    /** @type {Function} */ listener
  ) => listeners.set(type, listener);
}

/**
 * Render through the same route-slice path production mounts, in the same
 * order: a first render, then `start()`. The store state is supplied directly,
 * so the load hangs deliberately and never overwrites it — but the route's
 * effects are built, which is where every write path now lives.
 *
 * @param {any} initialState
 * @param {Record<string, any>} [contextOverrides]
 * @param {(container: any) => void} [seedContainer]
 * @param {{ caseType: string, id: string }} [routeParams]
 */
function renderShippedState(
  initialState,
  contextOverrides = {},
  seedContainer = undefined,
  routeParams = { caseType: 'example-review', id: 'c1' }
) {
  const never = new Promise(() => {});
  const slice = createRouteSlice(
    routeParams,
    /** @type {any} */ ({
      currentUser: chrome.currentUser,
      capabilities: chrome.permissions,
      chrome,
      ...contextOverrides,
      client: {
        getCase: () => never,
        getCurrentUser: () => never,
        getExportHash: () => never,
        resolveUsers: () => never,
        searchPeople: () => never,
        ...contextOverrides.client,
      },
      saveQueue: {
        subscribeStatus: () => () => {},
        ...contextOverrides.saveQueue,
      },
    })
  );
  let state = initialState;
  let active = true;
  /** @type {any[]} */
  const actions = [];
  const container = document.createElement('main');
  seedContainer?.(container);
  /** @type {Map<string, Function>} */
  const listeners = new Map();
  /** @type {any} */
  let tools;
  tools = {
    render,
    listen: captureListeners(listeners),
    dispatch(/** @type {any} */ action) {
      actions.push(action);
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    isActive: () => active,
  };
  slice.render(container, state, tools);
  const dispose = slice.start(tools);
  return {
    dispose,
    // Stand in for `createStoreRoute` disposing the mount: after this,
    // `tools.isActive()` reports false exactly as it would after the reviewer
    // navigated away mid-effect.
    deactivate() {
      active = false;
      dispose?.();
    },
    actions,
    container,
    listeners,
    dispatch(/** @type {any} */ action) {
      tools.dispatch(action);
    },
    get state() {
      return state;
    },
  };
}

test('state: route state owns loading, save status, and selected tab under routes.caseReview', () => {
  const initial = createInitialCaseReviewState(chrome);
  assert.equal(initial.chrome, chrome);
  assert.deepEqual(initial.routes.caseReview, {
    activeTab: '',
    conversationHidden: true,
    completionPending: false,
    captureCollapsed: {},
    captureSearch: {},
    responsiblePartySearch: { query: '', people: [] },
    saveStatus: 'saved',
    snapshot: null,
  });

  const loaded = caseReviewReducer(initial, {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  assert.equal(loaded.routes.caseReview.activeTab, 'details');
  assert.equal(loaded.routes.caseReview.snapshot?.caseRow, caseRow);

  const saving = caseReviewReducer(loaded, {
    type: 'case/save-status-changed',
    status: 'saving',
  });
  assert.equal(saving.routes.caseReview.saveStatus, 'saving');

  const pending = caseReviewReducer(loaded, {
    type: 'case/completion-pending',
    pending: true,
  });
  assert.equal(pending.routes.caseReview.completionPending, true);
  assert.equal(
    caseReviewReducer(pending, {
      type: 'case/completion-pending',
      pending: true,
    }),
    pending,
    'an unchanged completion state is referentially stable'
  );
});

test('state: the Conversation panel starts collapsed on every load', () => {
  // The loader's snapshot carries no conversation-visibility field: the
  // reducer owns "collapsed on load", not the handover.
  const loadSnapshot = () => ({
    ...snapshot(),
    machine: { canToggleConversation: true },
  });

  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadSnapshot(),
  });
  assert.equal(state.routes.caseReview.conversationHidden, true);

  state = caseReviewReducer(state, { type: 'case/conversation-toggled' });
  assert.equal(state.routes.caseReview.conversationHidden, false);

  // Loading again re-collapses the panel, whatever the reader had revealed.
  state = caseReviewReducer(state, {
    type: 'case/load-finished',
    snapshot: loadSnapshot(),
  });
  assert.equal(state.routes.caseReview.conversationHidden, true);
});

test('On hold reducer: updates both hold fields in the loaded Case snapshot', () => {
  const loaded = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  const placedOnHoldAt = '2026-07-23T09:30:00.000Z';

  const held = caseReviewReducer(loaded, {
    type: 'case/on-hold-changed',
    onHold: true,
    placedOnHoldAt,
  });
  assert.equal(held.routes.caseReview.snapshot?.caseRow?.onHold, true);
  assert.equal(
    held.routes.caseReview.snapshot?.caseRow?.placedOnHoldAt,
    placedOnHoldAt
  );

  const resumed = caseReviewReducer(held, {
    type: 'case/on-hold-changed',
    onHold: false,
    placedOnHoldAt: null,
  });
  assert.equal(resumed.routes.caseReview.snapshot?.caseRow?.onHold, false);
  assert.equal(
    resumed.routes.caseReview.snapshot?.caseRow?.placedOnHoldAt,
    null
  );
});

test('state: expanding a capture group preserves an override of a collapsed case-type default', () => {
  const initial = createInitialCaseReviewState(chrome);

  const expanded = caseReviewReducer(initial, {
    type: 'case/capture-group-toggled',
    questionId: 'q-needs',
    groupKey: 'customer-impact',
    collapsed: false,
  });

  assert.deepEqual(
    expanded.routes.caseReview.captureCollapsed['q-needs'],
    new Map([['customer-impact', false]])
  );
});

test('state: capture person search is held per failed Question and per field', () => {
  let state = createInitialCaseReviewState(chrome);
  state = caseReviewReducer(state, {
    type: 'case/capture-search-input',
    questionId: 'q1',
    fieldKey: 'attributedTo',
    query: 'Jane',
  });
  state = caseReviewReducer(state, {
    type: 'case/capture-search-input',
    questionId: 'q1',
    fieldKey: 'reviewedBy',
    query: 'Alex',
  });
  state = caseReviewReducer(state, {
    type: 'case/capture-search-results',
    questionId: 'q1',
    fieldKey: 'attributedTo',
    query: 'Jane',
    people: [{ loginName: 'jsmith', displayName: 'Jane Smith' }],
  });

  assert.deepEqual(state.routes.caseReview.captureSearch, {
    q1: {
      attributedTo: {
        query: 'Jane',
        people: [{ loginName: 'jsmith', displayName: 'Jane Smith' }],
      },
      reviewedBy: { query: 'Alex', people: [] },
    },
  });

  for (const stale of [
    { questionId: 'q1', fieldKey: 'attributedTo', query: 'Ja' },
    { questionId: 'q1', fieldKey: 'unknown', query: 'Jane' },
    { questionId: 'q2', fieldKey: 'attributedTo', query: 'Jane' },
  ]) {
    assert.equal(
      caseReviewReducer(state, {
        type: 'case/capture-search-results',
        ...stale,
        people: [],
      }),
      state,
      'results the Reviewer has typed past are dropped'
    );
  }

  const cleared = caseReviewReducer(state, {
    type: 'case/capture-search-cleared',
    questionId: 'q1',
    fieldKey: 'attributedTo',
  });
  assert.deepEqual(cleared.routes.caseReview.captureSearch, {
    q1: { reviewedBy: { query: 'Alex', people: [] } },
  });
  for (const absent of [
    { questionId: 'q1', fieldKey: 'attributedTo' },
    { questionId: 'missing', fieldKey: 'attributedTo' },
  ]) {
    assert.equal(
      caseReviewReducer(cleared, {
        type: 'case/capture-search-cleared',
        ...absent,
      }),
      cleared,
      'clearing a search that is not open changes nothing'
    );
  }
});

/**
 * Mount the shipped Issues panel over a Case Type whose capture groups declare
 * a `person` field, with a Reviewer who may edit the tab and the Case load left
 * pending, so the person search is exercised only through the route's public
 * render/start seams.
 *
 * @param {(query: string) => Promise<any[]>} searchPeople
 */
function renderCaptureSearchRoute(searchPeople) {
  const failedSnapshot = snapshot();
  failedSnapshot.catalogue[0].failureValues = ['No'];
  failedSnapshot.answers = { q1: { value: 'No' } };
  failedSnapshot.caseRow = {
    ...failedSnapshot.caseRow,
    answers: failedSnapshot.answers,
  };
  failedSnapshot.config.captureGroups = [
    {
      key: 'blame',
      label: 'Blame',
      fields: [{ key: 'attributedTo', label: 'Attributed to', type: 'person' }],
    },
  ];
  failedSnapshot.machine = {
    canEditIssues: true,
    canToggleConversation: false,
  };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: failedSnapshot,
  });
  state = caseReviewReducer(state, { type: 'case/tab-selected', id: 'issues' });
  const never = new Promise(() => {});
  const client = /** @type {any} */ ({
    getCase: () => never,
    getCurrentUser: async () => chrome.currentUser,
    getExportHash: async () => null,
    resolveUsers: async () => ({}),
    searchPeople,
  });
  const saveQueue = new SaveQueue(client, { debounceMs: 0 });
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    /** @type {any} */ ({ client, saveQueue, chrome })
  );
  const container = document.createElement('main');
  let active = true;
  /** @type {any} */
  let tools;
  tools = {
    render,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    listen() {},
    isActive: () => active,
  };
  slice.render(container, state, tools);
  const teardown = slice.start(tools);
  return {
    container,
    dispose() {
      active = false;
      teardown?.();
    },
    get state() {
      return state;
    },
  };
}

test('route: a person capture field searches, records the person, and closes its search', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {string[]} */
  const searches = [];
  const route = renderCaptureSearchRoute(async (query) => {
    searches.push(query);
    return [{ loginName: 'jsmith', displayName: 'Jane Smith' }];
  });

  const input = getByRole(route.container, 'combobox', {
    name: 'Search people for Attributed to',
  });
  input.value = 'Jane';
  fireEvent(input, 'input');
  assert.equal(
    route.state.routes.caseReview.captureSearch.q1.attributedTo.query,
    'Jane'
  );

  t.mock.timers.tick(200);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(searches, ['Jane']);

  fireEvent(
    getByRole(route.container, 'option', { name: /Jane Smith/ }),
    'click'
  );
  assert.deepEqual(
    route.state.routes.caseReview.snapshot?.answers.q1.capture,
    { attributedTo: { loginName: 'jsmith', displayName: 'Jane Smith' } },
    'the chosen person is recorded on the Answer'
  );
  assert.equal(
    route.state.routes.caseReview.captureSearch.q1.attributedTo,
    undefined,
    'choosing someone closes the search that found them'
  );
  assert.equal(
    getByRole(route.container, 'button', { name: 'Clear Attributed to' })
      .tagName,
    'BUTTON'
  );
  route.dispose();
});

/**
 * Mount the shipped Issues panel with the Case-level Responsible Party picker
 * editable, so the field is exercised only through the route's public
 * render/start seams. The queue is real and un-debounced, so a selection can be
 * followed all the way to the PATCH.
 *
 * @param {(query: string) => Promise<any[]>} searchPeople
 */
function renderResponsiblePartyRoute(searchPeople) {
  const editableSnapshot = snapshot();
  editableSnapshot.caseRow = {
    ...editableSnapshot.caseRow,
    responsibleParty: '',
  };
  editableSnapshot.machine = {
    canEditIssues: true,
    canToggleConversation: false,
  };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: editableSnapshot,
  });
  state = caseReviewReducer(state, { type: 'case/tab-selected', id: 'issues' });
  const never = new Promise(() => {});
  /** @type {any[]} */
  const patches = [];
  const client = /** @type {any} */ ({
    getCase: () => never,
    getCurrentUser: async () => chrome.currentUser,
    getExportHash: async () => null,
    resolveUsers: async () => ({}),
    searchPeople,
    async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
      patches.push(fields);
      return { ok: true, status: 200, data: { ...caseRow, ...fields } };
    },
  });
  const saveQueue = new SaveQueue(client, { debounceMs: 0 });
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    /** @type {any} */ ({ client, saveQueue, chrome })
  );
  const container = document.createElement('main');
  let active = true;
  /** @type {any} */
  let tools;
  tools = {
    render,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    listen() {},
    isActive: () => active,
  };
  slice.render(container, state, tools);
  const teardown = slice.start(tools);
  return {
    container,
    patches,
    dispose() {
      active = false;
      teardown?.();
    },
    get state() {
      return state;
    },
  };
}

test('state: the Case-level Responsible Party search is one query, not one per Question', () => {
  let state = createInitialCaseReviewState(chrome);
  state = caseReviewReducer(state, {
    type: 'case/responsible-party-search-input',
    query: 'Jane',
  });
  assert.deepEqual(state.routes.caseReview.responsiblePartySearch, {
    query: 'Jane',
    people: [],
  });

  const found = caseReviewReducer(state, {
    type: 'case/responsible-party-search-results',
    query: 'Jane',
    people: [{ loginName: 'jsmith', displayName: 'Jane Smith' }],
  });
  assert.deepEqual(found.routes.caseReview.responsiblePartySearch, {
    query: 'Jane',
    people: [{ loginName: 'jsmith', displayName: 'Jane Smith' }],
  });

  assert.equal(
    caseReviewReducer(found, {
      type: 'case/responsible-party-search-results',
      query: 'Jan',
      people: [],
    }),
    found,
    'results for a query the Reviewer has typed past must not re-render'
  );

  const typedAgain = caseReviewReducer(found, {
    type: 'case/responsible-party-search-input',
    query: 'Janet',
  });
  assert.deepEqual(typedAgain.routes.caseReview.responsiblePartySearch, {
    query: 'Janet',
    people: [],
  });

  const cleared = caseReviewReducer(typedAgain, {
    type: 'case/responsible-party-search-cleared',
  });
  assert.deepEqual(cleared.routes.caseReview.responsiblePartySearch, {
    query: '',
    people: [],
  });
  assert.equal(
    caseReviewReducer(cleared, {
      type: 'case/responsible-party-search-cleared',
    }),
    cleared,
    'clearing a search that is already empty must not re-render'
  );
});

test('state: setting the Responsible Party advances the Case Row and leaves the access matrix alone', () => {
  // The matrix is a load-time evaluation: it is built from the row the load
  // handed over, and every `can*` getter reads that frozen copy. Re-deriving it
  // from an optimistic edit would change the permission surface mid-session.
  const loaded = snapshot();
  loaded.caseRow = { ...loaded.caseRow, responsibleParty: '' };
  loaded.machine = { canEditIssues: true };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loaded,
  });

  const set = caseReviewReducer(state, {
    type: 'case/responsible-party-changed',
    loginName: 'jsmith',
    displayName: 'John Smith',
  });
  assert.equal(
    set.routes.caseReview.snapshot?.caseRow?.responsibleParty,
    'jsmith'
  );
  assert.equal(
    set.routes.caseReview.snapshot?.caseRow?.responsiblePartyDisplayName,
    'John Smith',
    'the person just chosen is named on the spot, not on the next read'
  );
  assert.equal(
    set.routes.caseReview.snapshot?.machine,
    loaded.machine,
    'the machine the load built is the machine the page keeps'
  );
  assert.equal(
    caseReviewReducer(set, {
      type: 'case/responsible-party-changed',
      loginName: 'jsmith',
      displayName: 'John Smith',
    }),
    set,
    're-selecting the same person must not re-render'
  );
});

test('the reducer ignores a case/field-edited naming the Responsible Party', () => {
  // The field has its own action and its own writer precisely because the
  // generic plain-text writer would be the wrong path for a value that resolves
  // a Role.
  const loaded = snapshot();
  loaded.caseRow = { ...loaded.caseRow, responsibleParty: '' };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loaded,
  });

  assert.equal(
    caseReviewReducer(state, {
      type: 'case/field-edited',
      field: 'responsibleParty',
      value: 'jsmith',
    }),
    state
  );
});

test('route: the Responsible Party search is debounced and its choice is persisted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {string[]} */
  const searches = [];
  const route = renderResponsiblePartyRoute(async (query) => {
    searches.push(query);
    return [{ loginName: 'jsmith', displayName: 'Jane Smith' }];
  });
  const input = getByRole(route.container, 'combobox', {
    name: 'Search people for Responsible Party',
  });
  input.value = 'Ja';
  fireEvent(input, 'input');
  const retyped = getByRole(route.container, 'combobox', {
    name: 'Search people for Responsible Party',
  });
  retyped.value = 'Jane';
  fireEvent(retyped, 'input');
  assert.equal(
    route.state.routes.caseReview.responsiblePartySearch.query,
    'Jane'
  );

  t.mock.timers.tick(199);
  assert.deepEqual(searches, []);
  t.mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(searches, ['Jane']);

  fireEvent(
    getByRole(route.container, 'option', { name: /Jane Smith/ }),
    'click'
  );
  assert.equal(
    route.state.routes.caseReview.snapshot?.caseRow?.responsibleParty,
    'jsmith'
  );
  assert.deepEqual(route.state.routes.caseReview.responsiblePartySearch, {
    query: '',
    people: [],
  });
  t.mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(route.patches, [{ responsibleParty: 'jsmith' }]);
  route.dispose();
});

test('route: disposal drops a pending Responsible Party search', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {string[]} */
  const searches = [];
  const route = renderResponsiblePartyRoute(async (query) => {
    searches.push(query);
    return [];
  });
  const input = getByRole(route.container, 'combobox', {
    name: 'Search people for Responsible Party',
  });
  input.value = 'Never sent';
  fireEvent(input, 'input');
  route.dispose();
  t.mock.timers.tick(200);

  assert.deepEqual(searches, []);
});

test('state: tab selection is store-owned and rejects hidden Sections', () => {
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'notes',
  });
  assert.equal(state.routes.caseReview.activeTab, 'notes');

  const unchanged = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'remediation',
  });
  assert.equal(unchanged, state, 'hidden Section cannot become active');
});

test('route: the conversation host is a direct child the scoped popover CSS can target', () => {
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  const { container } = renderShippedState(state);
  const root = container.querySelector('.cora-case-review');
  assert.ok(root, 'the case-review root is rendered');
  assert.equal(root.getAttribute('data-conversation-mode'), 'popover');
  // The popover/sidebar CSS selects
  // `.cora-case-review[data-conversation-mode='…'] > .cora-case-review__conversation`.
  // The conversation host must therefore carry that class and be a *direct*
  // child of the root, else it renders inline instead of as a floating panel.
  const conversation = container.querySelector(
    '.cora-case-review__conversation'
  );
  assert.ok(conversation, 'conversation host carries the scoped class');
  assert.equal(
    conversation.parentNode,
    root,
    'conversation host is a direct child of the root'
  );
});

test('route: mounting over a previous route’s leftover DOM keeps the conversation host live', () => {
  const toggleSnapshot = snapshot();
  toggleSnapshot.machine = {
    ...toggleSnapshot.machine,
    canToggleConversation: true,
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: toggleSnapshot,
  });
  // The router does not clear the container between routes; the incoming
  // route's first render replaces whatever the previous page left behind.
  // Seed a tree render() would happily patch in place (a div of divs, the
  // same shape as the case shell) so node reuse is exercised.
  const rendered = renderShippedState(state, {}, (container) => {
    const leftover = document.createElement('div');
    for (let i = 0; i < 5; i += 1) {
      leftover.appendChild(document.createElement('div'));
    }
    container.appendChild(leftover);
  });
  const { container } = rendered;
  const conversation = /** @type {any} */ (
    container.querySelector('.cora-case-review__conversation')
  );
  assert.ok(conversation, 'conversation host is rendered into the container');
  assert.equal(
    conversation.hidden,
    true,
    'the in-document conversation host starts hidden'
  );

  rendered.dispatch({ type: 'case/conversation-toggled' });
  assert.equal(
    conversation.hidden,
    false,
    'toggling reveals the same in-document conversation host'
  );
  assert.ok(
    conversation.querySelector('.cora-conversation-panel'),
    'the in-document conversation host receives the panel content'
  );
});

test('route: Appeal renders directly from store state without legacy controller wiring', () => {
  const appealSnapshot = snapshot();
  appealSnapshot.access = {
    ...appealSnapshot.access,
    appealRequest: 'edit',
  };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: appealSnapshot,
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'appealRequest',
  });

  const { container } = renderShippedState(state);
  const panel = queryAllByRole(container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-appealRequest'
  );
  assert.ok(panel);
  assert.equal(panel.querySelectorAll('.cora-appeal').length, 1);
  assert.equal(
    getByRole(panel, 'button', { name: 'Raise Appeal' }).textContent,
    'Raise Appeal'
  );
});

test('route: configured Journey Owner and alternative Manager raisers reach the converted Appeal surface', () => {
  const configurations = [
    {
      label: 'Complaints Journey Owner',
      config: complaintsConfig,
      roles:
        /** @type {import('../src/services/section-access.js').Role[]} */ ([
          'journeyOwner',
        ]),
    },
    {
      label: 'alternative Responsible Party Manager',
      config: {
        ...complaintsConfig,
        appeal: {
          raisedBy: /** @type {const} */ ('responsiblePartyManager'),
        },
      },
      roles:
        /** @type {import('../src/services/section-access.js').Role[]} */ ([
          'responsiblePartyManager',
        ]),
    },
  ];

  for (const { label, config, roles } of configurations) {
    const appealSnapshot = snapshot();
    appealSnapshot.caseRow = {
      ...appealSnapshot.caseRow,
      status: 'Completed',
    };
    appealSnapshot.access = {
      ...appealSnapshot.access,
      appealRequest: evaluateAccess(
        'appealRequest',
        roles,
        appealSnapshot.caseRow,
        config
      ),
    };
    let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
      type: 'case/load-finished',
      snapshot: appealSnapshot,
    });
    state = caseReviewReducer(state, {
      type: 'case/tab-selected',
      id: 'appealRequest',
    });

    const { container } = renderShippedState(state);
    const panel = queryAllByRole(container, 'tabpanel').find(
      (candidate) => candidate.getAttribute('id') === 'case-panel-appealRequest'
    );
    assert.ok(panel, label);
    assert.equal(
      getByRole(panel, 'button', { name: 'Raise Appeal' }).textContent,
      'Raise Appeal',
      label
    );
  }
});

test('route: raising an Appeal persists through the store-owned panel', () => {
  const appealSnapshot = snapshot();
  appealSnapshot.access = {
    ...appealSnapshot.access,
    appealRequest: 'edit',
  };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: appealSnapshot,
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'appealRequest',
  });
  /** @type {Array<{id: string, field: string, value: any}>} */
  const writes = [];
  const { container } = renderShippedState(state, {
    saveQueue: {
      enqueue(
        /** @type {string} */ id,
        /** @type {string} */ field,
        /** @type {any} */ value
      ) {
        writes.push({ id, field, value });
      },
    },
  });
  const panel = queryAllByRole(container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-appealRequest'
  );
  assert.ok(panel);
  getByRole(panel, 'textbox', { name: 'Appeal rationale' }).value =
    'The result is wrong.';
  fireEvent(getByRole(panel, 'button', { name: 'Raise Appeal' }), 'click');

  assert.equal(writes.length, 1);
  assert.equal(writes[0].field, 'appeals');
  assert.equal(writes[0].value[0].state, 'raised');
});

test('route: a raised Appeal is resolvable in the same mount from the store-owned Case Row', () => {
  const appealSnapshot = snapshot();
  appealSnapshot.caseRow = {
    ...appealSnapshot.caseRow,
    status: 'Completed',
    outcomeAtCompletion: 'fail',
    appeals: [],
  };
  appealSnapshot.access = {
    ...appealSnapshot.access,
    appealRequest: 'edit',
    appealReview: 'edit',
  };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: appealSnapshot,
  });
  /** @type {Array<{id: string, field: string, value: any}>} */
  const writes = [];
  /** @type {Array<{id: string, fields: any}>} */
  const fieldWrites = [];
  const route = renderShippedState(state, {
    saveQueue: {
      enqueue(
        /** @type {string} */ id,
        /** @type {string} */ field,
        /** @type {any} */ value
      ) {
        writes.push({ id, field, value });
      },
      enqueueFields(/** @type {string} */ id, /** @type {any} */ fields) {
        fieldWrites.push({ id, fields });
      },
    },
  });

  fireEvent(getByRole(route.container, 'tab', { name: 'Appeal' }), 'click');
  const raisePanel = queryAllByRole(route.container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-appealRequest'
  );
  assert.ok(raisePanel);
  getByRole(raisePanel, 'textbox', { name: 'Appeal rationale' }).value =
    'The result is wrong.';
  fireEvent(getByRole(raisePanel, 'button', { name: 'Raise Appeal' }), 'click');
  assert.equal(writes.length, 1);
  const raisedId = writes[0].value[0].id;

  // The Appeal exists only in the store now. Resolving it in the same mount is
  // the read-back that would fail if the loader still held a competing copy —
  // and the proof the loader's copy is not needed.
  fireEvent(
    getByRole(route.container, 'tab', { name: 'Appeal Review' }),
    'click'
  );
  const reviewPanel = queryAllByRole(route.container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-appealReview'
  );
  assert.ok(reviewPanel);
  getByRole(reviewPanel, 'radio', { name: 'Reject' }).checked = true;
  getByRole(reviewPanel, 'textbox', { name: 'Resolution rationale' }).value =
    'The original outcome stands.';
  fireEvent(
    getByRole(reviewPanel, 'button', { name: 'Resolve Appeal' }),
    'click'
  );

  assert.equal(writes.length, 2);
  assert.equal(writes[1].value[0].id, raisedId);
  assert.equal(writes[1].value[0].state, 'resolved');
  assert.equal(
    route.state.routes.caseReview.snapshot?.caseRow?.appeals?.[0].state,
    'resolved'
  );
});

test('route: Appeal action remains live after switching from another tab', () => {
  const appealSnapshot = snapshot();
  appealSnapshot.caseRow = { ...appealSnapshot.caseRow, appeals: [] };
  appealSnapshot.access = {
    ...appealSnapshot.access,
    appealRequest: 'edit',
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: appealSnapshot,
  });
  /** @type {Array<{id: string, field: string, value: any}>} */
  const writes = [];
  const route = renderShippedState(state, {
    saveQueue: {
      enqueue(
        /** @type {string} */ id,
        /** @type {string} */ field,
        /** @type {any} */ value
      ) {
        writes.push({ id, field, value });
      },
    },
  });

  fireEvent(getByRole(route.container, 'tab', { name: 'Appeal' }), 'click');
  const panel = queryAllByRole(route.container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-appealRequest'
  );
  assert.ok(panel);
  getByRole(panel, 'textbox', { name: 'Appeal rationale' }).value =
    'The result is wrong.';
  const raise = getByRole(panel, 'button', { name: 'Raise Appeal' });
  fireEvent(raise, 'click');

  assert.equal(writes.length, 1);
});

test('route: Controls resolves an Appeal and amends an Outcome through state-derived edit access', () => {
  const controlsSnapshot = snapshot();
  controlsSnapshot.caseRow = {
    ...controlsSnapshot.caseRow,
    status: 'Completed',
    outcomeAtCompletion: 'fail',
    appeals: [
      {
        id: 'appeal-1',
        appellant: 'u2',
        at: '2026-07-19T10:00:00Z',
        rationale: 'Wrong result.',
        state: 'raised',
      },
    ],
  };
  controlsSnapshot.access = {
    ...controlsSnapshot.access,
    appealReview: 'edit',
    amendOutcome: 'edit',
  };
  controlsSnapshot.config.outcomeOptions = [
    { id: 'pass', wording: 'Pass', severity: 0 },
    { id: 'fail', wording: 'Fail', severity: 100 },
  ];
  /** @type {Array<{id: string, fields: any}>} */
  const fieldWrites = [];
  const saveQueue = {
    enqueue() {},
    enqueueFields(/** @type {string} */ id, /** @type {any} */ fields) {
      fieldWrites.push({ id, fields });
    },
  };

  let reviewState = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: controlsSnapshot,
  });
  reviewState = caseReviewReducer(reviewState, {
    type: 'case/tab-selected',
    id: 'appealReview',
  });
  const review = renderShippedState(reviewState, { saveQueue });
  const reviewPanel = queryAllByRole(review.container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-appealReview'
  );
  assert.ok(reviewPanel);
  getByRole(reviewPanel, 'radio', { name: 'Agree' }).checked = true;
  getByRole(reviewPanel, 'textbox', { name: 'Resolution rationale' }).value =
    'Agreed.';
  getByRole(reviewPanel, 'combobox', { name: 'Amended outcome' }).value =
    'pass';
  getByRole(reviewPanel, 'textbox', {
    name: 'Amendment justification',
  }).value = 'Corrected.';
  fireEvent(
    getByRole(reviewPanel, 'button', { name: 'Resolve Appeal' }),
    'click'
  );
  assert.equal(fieldWrites[0].fields.amendedOutcome.fromAppealId, 'appeal-1');

  controlsSnapshot.caseRow.appeals = [];
  let amendState = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: controlsSnapshot,
  });
  amendState = caseReviewReducer(amendState, {
    type: 'case/tab-selected',
    id: 'amendOutcome',
  });
  const amend = renderShippedState(amendState, { saveQueue });
  const amendPanel = queryAllByRole(amend.container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-amendOutcome'
  );
  assert.ok(amendPanel);
  getByRole(amendPanel, 'combobox', { name: 'Amended outcome' }).value = 'fail';
  getByRole(amendPanel, 'textbox', {
    name: 'Amendment justification',
  }).value = 'Reconsidered.';
  fireEvent(
    getByRole(amendPanel, 'button', { name: 'Amend Outcome' }),
    'click'
  );
  assert.equal(fieldWrites[1].fields.amendedOutcome.outcome, 'fail');
});

test('route: Appeal Review action remains live after switching from another tab', () => {
  const controlsSnapshot = snapshot();
  controlsSnapshot.caseRow = {
    ...controlsSnapshot.caseRow,
    status: 'Completed',
    outcomeAtCompletion: 'fail',
    appeals: [
      {
        id: 'appeal-1',
        appellant: 'u2',
        at: '2026-07-19T10:00:00Z',
        rationale: 'Wrong result.',
        state: 'raised',
      },
    ],
  };
  controlsSnapshot.access = {
    ...controlsSnapshot.access,
    appealReview: 'edit',
    amendOutcome: 'edit',
  };
  /** @type {Array<{id: string, fields: any}>} */
  const writes = [];
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: controlsSnapshot,
  });
  const route = renderShippedState(state, {
    saveQueue: {
      enqueue() {},
      enqueueFields(/** @type {string} */ id, /** @type {any} */ fields) {
        writes.push({ id, fields });
      },
    },
  });

  fireEvent(
    getByRole(route.container, 'tab', { name: 'Appeal Review' }),
    'click'
  );
  const panel = queryAllByRole(route.container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-appealReview'
  );
  assert.ok(panel);
  getByRole(panel, 'radio', { name: 'Agree' }).checked = true;
  getByRole(panel, 'textbox', { name: 'Resolution rationale' }).value =
    'Agreed.';
  getByRole(panel, 'combobox', { name: 'Amended outcome' }).value = 'pass';
  getByRole(panel, 'textbox', { name: 'Amendment justification' }).value =
    'Corrected.';
  fireEvent(getByRole(panel, 'button', { name: 'Resolve Appeal' }), 'click');

  assert.equal(writes.length, 1);
  assert.equal(writes[0].fields.amendedOutcome.fromAppealId, 'appeal-1');
});

test('route: Amend Outcome action remains live after switching from another tab', () => {
  const controlsSnapshot = snapshot();
  controlsSnapshot.caseRow = {
    ...controlsSnapshot.caseRow,
    status: 'Completed',
    outcomeAtCompletion: 'fail',
  };
  controlsSnapshot.access = {
    ...controlsSnapshot.access,
    amendOutcome: 'edit',
  };
  /** @type {Array<{id: string, fields: any}>} */
  const writes = [];
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: controlsSnapshot,
  });
  const route = renderShippedState(state, {
    saveQueue: {
      enqueue() {},
      enqueueFields(/** @type {string} */ id, /** @type {any} */ fields) {
        writes.push({ id, fields });
      },
    },
  });

  fireEvent(
    getByRole(route.container, 'tab', { name: 'Amend Outcome' }),
    'click'
  );
  const panel = queryAllByRole(route.container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-amendOutcome'
  );
  assert.ok(panel);
  getByRole(panel, 'combobox', { name: 'Amended outcome' }).value = 'pass';
  getByRole(panel, 'textbox', { name: 'Amendment justification' }).value =
    'Corrected.';
  fireEvent(getByRole(panel, 'button', { name: 'Amend Outcome' }), 'click');

  assert.equal(writes.length, 1);
  assert.equal(writes[0].fields.amendedOutcome.outcome, 'pass');
});

test('route: appeal views keep empty Case Type configuration defaults', () => {
  const minimal = snapshot();
  minimal.caseRow = { ...minimal.caseRow, responsibleParty: '' };
  delete minimal.config.detailFields;
  delete minimal.config.captureGroups;
  delete minimal.config.placeholders;
  delete minimal.config.outcomeOptions;
  minimal.access = {
    ...minimal.access,
    appealRequest: 'hidden',
    appealReview: 'read-only',
    amendOutcome: 'read-only',
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: minimal,
  });
  const { container } = renderShippedState(state);

  assert.equal(
    queryAllByRole(container, 'tab').some(
      (tab) => tab.textContent === 'Appeal'
    ),
    false
  );
  assert.equal(
    getByRole(container, 'tab', { name: 'Appeal Review' }).hidden,
    false
  );
  assert.equal(
    getByRole(container, 'tab', { name: 'Amend Outcome' }).hidden,
    false
  );
});

test('case page reducer: every identity guard returns the same state reference', () => {
  const loaded = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  const activeTab = loaded.routes.caseReview.activeTab;

  assert.strictEqual(
    caseReviewReducer(loaded, { type: 'case/tab-selected', id: activeTab }),
    loaded,
    're-selecting the active Section must not re-render'
  );
  assert.strictEqual(
    caseReviewReducer(loaded, { type: 'case/tab-selected', id: 'remediation' }),
    loaded,
    'a hidden Section cannot become active'
  );
  assert.strictEqual(
    caseReviewReducer(loaded, {
      type: 'case/completion-pending',
      pending: loaded.routes.caseReview.completionPending,
    }),
    loaded,
    'an unchanged completion flag must not re-render'
  );
  assert.strictEqual(
    caseReviewReducer(loaded, {
      type: 'case/save-status-changed',
      status: loaded.routes.caseReview.saveStatus,
    }),
    loaded,
    'an unchanged save status must not re-render'
  );

  assert.strictEqual(
    caseReviewReducer(loaded, { type: 'case/conversation-toggled' }),
    loaded,
    'toggling the Conversation the machine forbids must not re-render'
  );
});

test('case page reducer: a patch preserves chrome and unrelated route fields', () => {
  const initial = createInitialCaseReviewState(chrome);
  const loaded = caseReviewReducer(initial, {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  const next = caseReviewReducer(loaded, {
    type: 'case/save-status-changed',
    status: 'saving',
  });

  assert.strictEqual(next.chrome, chrome);
  assert.strictEqual(
    next.routes.caseReview.snapshot,
    loaded.routes.caseReview.snapshot
  );
  assert.equal(
    next.routes.caseReview.activeTab,
    loaded.routes.caseReview.activeTab
  );
});

test('state: model refreshes and Answer edits preserve valid selection and fall back when access changes', () => {
  const initial = createInitialCaseReviewState(chrome);
  assert.equal(
    caseReviewReducer(initial, {
      type: 'case/answers-edited',
      answers: {},
    }),
    initial,
    'Answer action before load is inert'
  );
  assert.equal(
    caseReviewReducer(initial, {
      type: 'case/save-status-changed',
      status: 'saved',
    }),
    initial,
    'unchanged save status is referentially stable'
  );

  let state = caseReviewReducer(initial, {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'notes',
  });
  state = caseReviewReducer(state, {
    type: 'case/answers-edited',
    answers: { q1: { value: 'Yes' } },
  });
  assert.equal(state.routes.caseReview.activeTab, 'notes');
  assert.deepEqual(state.routes.caseReview.snapshot?.caseRow?.answers, {
    q1: { value: 'Yes' },
  });

  const restricted = {
    ...snapshot(),
    access: { ...snapshot().access, notes: 'hidden' },
  };
  state = caseReviewReducer(state, {
    type: 'case/model-changed',
    snapshot: restricted,
  });
  assert.equal(state.routes.caseReview.activeTab, 'details');
  assert.equal(caseReviewReducer(state, { type: 'unknown' }), state);
});

test('case page reducer keeps conversation and field state behind loaded access', () => {
  const initial = createInitialCaseReviewState(chrome);
  assert.equal(
    caseReviewReducer(initial, {
      type: 'case/conversation-changed',
      messages: [],
    }),
    initial
  );
  assert.equal(
    caseReviewReducer(initial, {
      type: 'case/field-edited',
      field: 'notes',
      value: 'x',
    }),
    initial
  );

  const grouped = {
    ...snapshot(),
    machine: { canToggleConversation: true },
    applicableQuestions: [
      ...snapshot().applicableQuestions,
      {
        id: 'q2',
        text: 'Question two',
        questionGroup: 'Follow-up',
        responseType: 'yes-no-na',
        deprecated: false,
      },
    ],
  };
  let state = caseReviewReducer(initial, {
    type: 'case/load-finished',
    snapshot: grouped,
  });

  state = caseReviewReducer(state, { type: 'case/conversation-toggled' });
  assert.equal(state.routes.caseReview.conversationHidden, false);
  state = caseReviewReducer(state, {
    type: 'case/conversation-changed',
    messages: [{ body: 'Updated message' }],
  });
  assert.deepEqual(state.routes.caseReview.snapshot?.caseRow?.conversation, [
    { body: 'Updated message' },
  ]);
  state = caseReviewReducer(state, {
    type: 'case/field-edited',
    field: 'notes',
    value: 'Updated note',
  });
  assert.equal(
    state.routes.caseReview.snapshot?.caseRow?.notes,
    'Updated note'
  );

  const hiddenConversation = /** @type {any} */ ({
    ...state,
    routes: {
      caseReview: {
        ...state.routes.caseReview,
        snapshot: {
          ...state.routes.caseReview.snapshot,
          access: {
            ...state.routes.caseReview.snapshot?.access,
            conversation: 'hidden',
          },
        },
      },
    },
  });
  assert.equal(
    caseReviewReducer(hiddenConversation, {
      type: 'case/conversation-toggled',
    }),
    hiddenConversation
  );

  const lifecycleBlockedConversation = /** @type {any} */ ({
    ...state,
    routes: {
      caseReview: {
        ...state.routes.caseReview,
        snapshot: {
          ...state.routes.caseReview.snapshot,
          machine: { canToggleConversation: false },
          access: {
            ...state.routes.caseReview.snapshot?.access,
            conversation: 'read-only',
          },
        },
      },
    },
  });
  assert.equal(
    caseReviewReducer(lifecycleBlockedConversation, {
      type: 'case/conversation-toggled',
    }),
    lifecycleBlockedConversation,
    'a visible conversation remains closed when the lifecycle gate blocks toggling'
  );
});

test('Details view mirrors today: config-driven values are read-only with empty fallback', () => {
  const view = caseDetailsView(
    caseRow,
    snapshot().config.detailFields,
    'Case Details'
  );
  assert.equal(getByTag(view, 'h2').textContent, 'Case Details');
  assert.match(view.textContent, /Customer nameAda Lovelace/);
  assert.match(view.textContent, /Account number—/);
  assert.equal(queryAllByRole(view, 'textbox').length, 0);
  assert.equal(view.getAttribute('data-access'), 'read-only');
});

test('Details view captions the completedAt date "Completed on"', () => {
  const view = caseDetailsView(
    {
      .../** @type {any} */ (caseRow),
      completedAt: '2026-05-04',
    },
    [],
    'Case Details'
  );
  assert.match(view.textContent, /Completed on2026-05-04/);
});

test('Details view takes its heading from the resolved section labels', () => {
  const view = caseDetailsView(caseRow, [], 'About this Case');
  assert.equal(getByTag(view, 'h2').textContent, 'About this Case');
});

test('view: shipped tab shell renders only permitted tabs and dispatches selection', async () => {
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  const view = renderShippedState(state);

  const tabs = queryAllByRole(view.container, 'tab');
  assert.equal(tabs.length, 7);
  assert.ok(tabs.every((tab) => tab.getAttribute('type') === 'button'));
  fireEvent(getByRole(view.container, 'tab', { name: 'Notes' }), 'click');
  const keyEvent = fireEvent(
    getByRole(view.container, 'tab', { name: 'Notes' }),
    'keydown',
    {
      key: 'ArrowRight',
    }
  );
  assert.deepEqual(view.actions, [
    { type: 'case/tab-selected', id: 'notes' },
    { type: 'case/tab-selected', id: 'appealRequest' },
  ]);
  assert.equal(keyEvent.defaultPrevented, true);
  await flush();
  assert.equal(
    document.activeElement?.getAttribute('id'),
    'case-tab-appealRequest'
  );
  const visiblePanel = queryAllByRole(view.container, 'tabpanel').find(
    (panel) => !panel.hidden
  );
  assert.equal(visiblePanel?.getAttribute('id'), 'case-panel-appealRequest');
});

test('On hold view: only Reviewers with an In-progress Case see the current hold state', () => {
  const reviewerState = caseReviewReducer(
    createInitialCaseReviewState(chrome),
    { type: 'case/load-finished', snapshot: snapshot() }
  );
  const reviewerView = renderShippedState(reviewerState);
  const toggle = getByRole(reviewerView.container, 'button', {
    name: 'On hold',
  });

  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(toggle.getAttribute('aria-label'), null);

  const held = caseReviewReducer(reviewerState, {
    type: 'case/on-hold-changed',
    onHold: true,
    placedOnHoldAt: '2026-07-23T09:30:00.000Z',
  });
  assert.equal(
    getByRole(renderShippedState(held).container, 'button', {
      name: 'On hold',
    }).getAttribute('aria-pressed'),
    'true'
  );

  const nonReviewerChrome = {
    ...chrome,
    permissions: { ...chrome.permissions, isReviewer: false },
  };
  const nonReviewerState = caseReviewReducer(
    createInitialCaseReviewState(nonReviewerChrome),
    { type: 'case/load-finished', snapshot: snapshot() }
  );
  assert.equal(
    queryAllByRole(
      renderShippedState(nonReviewerState).container,
      'button'
    ).some((button) => button.textContent === 'On hold'),
    false
  );

  for (const status of ['Actions In Progress', 'Completed']) {
    const reportableState = caseReviewReducer(
      createInitialCaseReviewState(chrome),
      {
        type: 'case/load-finished',
        snapshot: {
          ...snapshot(),
          caseRow: { ...caseRow, status },
        },
      }
    );
    assert.equal(
      queryAllByRole(
        renderShippedState(reportableState).container,
        'button'
      ).some((button) => button.textContent === 'On hold'),
      false,
      `${status} Cases must not expose the On hold control`
    );
  }
});

test('view: Summary is rendered from store state and configured sections', () => {
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'summary',
  });

  const view = renderShippedState(state).container;
  const panel = queryAllByRole(view, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-summary'
  );
  assert.ok(panel);
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /Summary/);
  assert.match(panel.textContent, /Awaiting answers/);
  assert.match(panel.textContent, /Case Details/);
  assert.match(panel.textContent, /Questions/);
  assert.match(panel.textContent, /Issues/);
  const summaryHosts = panel.querySelectorAll('.cora-summary');
  assert.equal(
    summaryHosts.length,
    1,
    'the Summary keeps the light-DOM host targeted by its shipped CSS'
  );
  assert.equal(
    summaryHosts[0].querySelectorAll('.cora-outcome').length,
    1,
    'the Outcome keeps the nested host targeted by its Summary card CSS'
  );
});

test('view: Summary shows the live Outcome after every Outcome question is answered', () => {
  const outcomeSnapshot = snapshot();
  outcomeSnapshot.catalogue = [
    {
      id: 'q1',
      text: 'First outcome',
      responseType: 'outcome',
      options: ['Compliant', 'Non-compliant'],
      optionOutcomes: { Compliant: 'pass', 'Non-compliant': 'fail' },
      deprecated: false,
    },
    {
      id: 'q2',
      text: 'Second outcome',
      responseType: 'outcome',
      options: ['Compliant', 'Non-compliant'],
      optionOutcomes: { Compliant: 'pass', 'Non-compliant': 'fail' },
      deprecated: false,
    },
  ];
  outcomeSnapshot.applicableQuestions = outcomeSnapshot.catalogue;
  outcomeSnapshot.config.computeOutcome = (
    /** @type {Record<string, import('../src/sharepoint-client.js').Answer>} */ answers
  ) => ({
    outcome: Object.values(answers).some(
      (answer) => answer.value === 'Non-compliant'
    )
      ? 'fail'
      : 'pass',
  });

  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: outcomeSnapshot,
  });
  state = caseReviewReducer(state, {
    type: 'case/answers-edited',
    answers: {
      q1: { value: 'Compliant' },
      q2: { value: 'Non-compliant' },
    },
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'summary',
  });

  const view = renderShippedState(state).container;
  const panel = view.querySelector('#case-panel-summary');
  assert.equal(state.routes.caseReview.snapshot?.allAnswered, true);
  assert.match(panel?.textContent ?? '', /Non-compliant/);
  assert.doesNotMatch(panel?.textContent ?? '', /Awaiting answers/);
});

test('view: Summary applies empty config defaults and incomplete snapshots stay inert', () => {
  const baseSnapshot = snapshot();
  const minimalSummarySnapshot = {
    ...baseSnapshot,
    config: {
      computeOutcome: baseSnapshot.config.computeOutcome,
    },
  };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: minimalSummarySnapshot,
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'summary',
  });
  const view = renderShippedState(state).container;
  assert.match(view.textContent, /Awaiting answers/);

  const incomplete = {
    ...minimalSummarySnapshot,
    currentUser: null,
  };
  const incompleteState = caseReviewReducer(
    createInitialCaseReviewState(chrome),
    { type: 'case/load-finished', snapshot: incomplete }
  );
  assert.doesNotThrow(() => renderShippedState(incompleteState));
});

test('view: Issues renders failed Answers directly from route state', () => {
  const answers = {
    q1: {
      value: 'No',
      remediationRequired: 'yes',
      remediationActions: [{ id: 'q1-ra-0', text: 'Fix it' }],
    },
  };
  const loadedSnapshot = {
    ...snapshot(),
    answers,
    caseRow: { ...caseRow, answers },
    catalogue: [
      {
        id: 'q1',
        text: 'Question one',
        responseType: 'yes-no-na',
        failureValues: ['No'],
        remediationActions: ['Fix it'],
        deprecated: false,
      },
    ],
    applicableQuestions: [
      {
        id: 'q1',
        text: 'Question one',
        responseType: 'yes-no-na',
        failureValues: ['No'],
        remediationActions: ['Fix it'],
        deprecated: false,
      },
    ],
    access: { ...snapshot().access, issues: 'read-only' },
  };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadedSnapshot,
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'issues',
  });

  const { container } = renderShippedState(state);
  const panel = container.querySelector('#case-panel-issues');

  assert.ok(panel);
  assert.match(panel.textContent, /Question one/);
  assert.match(panel.textContent, /Fix it/);
  assert.equal(panel.querySelector('cora-remediation-section'), null);
});

test('action: completion flushes saves and persists only the CaseMachine transition', async () => {
  const transitionPatch = {
    status: 'Completed',
    completedAt: '2026-07-19T12:00:00Z',
    outcomeAtCompletion: 'pass',
    questionBankVersion: 'bank-hash',
  };
  const machine = /** @type {any} */ ({
    canComplete: true,
    mayResolveRemediation: false,
    transitionToCompleted: (
      /** @type {Function} */ computeOutcome,
      /** @type {Record<string, any>} */ answers,
      /** @type {string} */ exportHash
    ) => {
      calls.push(['transition', computeOutcome(answers).outcome, exportHash]);
      return transitionPatch;
    },
  });
  const loadedSnapshot = {
    ...snapshot(),
    machine,
    allAnswered: true,
    exportHash: 'bank-hash',
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadedSnapshot,
  });
  /** @type {any[]} */
  const calls = [];
  const view = renderShippedState(state, {
    saveQueue: {
      async flushCase(/** @type {string} */ id) {
        calls.push(['flush', id]);
        return true;
      },
      getEtag: () => 'e1',
    },
    client: {
      async patchCase(/** @type {any[]} */ ...args) {
        calls.push(['patch', ...args]);
        return { ok: true, status: 200 };
      },
    },
  });

  const button = getByRole(view.container, 'button', {
    name: 'Complete Case',
  });
  fireEvent(button, 'click');
  await flush();

  assert.deepEqual(calls, [
    ['transition', 'pass', 'bank-hash'],
    ['flush', 'c1'],
    ['patch', 'c1', transitionPatch, 'e1', {}],
  ]);
  assert.ok(
    view.actions.some(
      (action) => action.type === 'case/completion-pending' && action.pending
    )
  );
  assert.equal(view.state.routes.caseReview.completionPending, false);
  assert.equal(location.hash, '#/dashboard');
});

test('action: completion folds the persisted transition into the store Case Row', async () => {
  // The transition the Case Row must carry afterwards. Correctness here must not
  // rest on the navigation: the route reads its Case Row from the store, and
  // completing is the one transition whose fields never reached it — invisible
  // only because the mount ends. Remove the navigation and this is the
  // assertion that fails.
  const transitionPatch = {
    status: 'Completed',
    completedAt: '2026-07-19T12:00:00Z',
    outcomeAtCompletion: 'pass',
    hadRemediation: false,
    questionBankVersion: 'bank-hash',
  };
  const loadedSnapshot = {
    ...snapshot(),
    machine: /** @type {any} */ ({
      canComplete: true,
      mayResolveRemediation: false,
      catalogue: [],
      transitionToCompleted: () => transitionPatch,
    }),
    allAnswered: true,
    exportHash: 'bank-hash',
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadedSnapshot,
  });
  /** @type {any} */
  let persistedFields = null;
  const view = renderShippedState(state, {
    saveQueue: {
      async flushCase() {
        return true;
      },
      getEtag: () => 'e1',
    },
    client: {
      async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
        persistedFields = fields;
        return { ok: true, status: 200 };
      },
    },
  });

  fireEvent(
    getByRole(view.container, 'button', { name: 'Complete Case' }),
    'click'
  );
  await flush();

  const stored = view.state.routes.caseReview.snapshot.caseRow;
  assert.equal(persistedFields?.status, 'Completed');
  assert.equal(
    stored.status,
    persistedFields.status,
    'the store Case Row carries the status that was persisted'
  );
  assert.equal(stored.completedAt, persistedFields.completedAt);
  assert.equal(stored.outcomeAtCompletion, persistedFields.outcomeAtCompletion);
  // The rest of the row and the rest of the snapshot are carried through, not
  // replaced by the patch.
  assert.equal(stored.id, caseRow.id);
  assert.equal(stored.assignedReviewer, caseRow.assignedReviewer);
  assert.equal(
    view.state.routes.caseReview.snapshot.catalogue,
    loadedSnapshot.catalogue
  );
});

test('action: the Send Actions transition folds into the store Case Row too', async () => {
  // The non-terminal half of the same path: sending Remediation Actions is not
  // the end of the Case, yet it goes through `completeCase` and navigates away.
  // A Case Type that kept the Reviewer in the Remediation loop would read a
  // pre-transition row on the very next render.
  const catalogue = [
    {
      id: 'q1',
      text: 'Question one',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      remediationActions: ['Fix it'],
      deprecated: false,
    },
  ];
  const answers = {
    q1: {
      value: 'No',
      remediationRequired: 'yes',
      remediationActions: [{ id: 'q1-ra-0', text: 'Fix it' }],
    },
  };
  const transitionPatch = {
    status: 'Actions In Progress',
    hadRemediation: true,
    outcomeAtCompletion: 'fail',
    questionBankVersion: 'bank-hash',
  };
  const loadedSnapshot = {
    ...snapshot(),
    catalogue,
    applicableQuestions: catalogue,
    answers,
    caseRow: { ...caseRow, answers },
    machine: /** @type {any} */ ({
      canComplete: true,
      mayResolveRemediation: false,
      catalogue,
      transitionToActionsInProgress: () => transitionPatch,
    }),
    allAnswered: true,
    exportHash: 'bank-hash',
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadedSnapshot,
  });
  /** @type {any} */
  let persistedFields = null;
  const view = renderShippedState(state, {
    saveQueue: {
      async flushCase() {
        return true;
      },
      getEtag: () => 'e1',
    },
    client: {
      async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
        persistedFields = fields;
        return { ok: true, status: 200 };
      },
    },
  });

  fireEvent(
    getByRole(view.container, 'button', { name: 'Send Actions' }),
    'click'
  );
  await flush();

  const stored = view.state.routes.caseReview.snapshot.caseRow;
  assert.equal(persistedFields?.status, 'Actions In Progress');
  assert.equal(
    stored.status,
    persistedFields.status,
    'the store Case Row carries the sent-actions status that was persisted'
  );
  assert.equal(stored.hadRemediation, true);
  assert.equal(
    stored.answers,
    answers,
    'the Answers on the row are untouched by the lifecycle patch'
  );
});

test('action: a failed completion PATCH leaves the store Case Row as it was', async () => {
  const loadedSnapshot = {
    ...snapshot(),
    machine: /** @type {any} */ ({
      canComplete: true,
      mayResolveRemediation: false,
      catalogue: [],
      transitionToCompleted: () => ({ status: 'Completed' }),
    }),
    allAnswered: true,
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadedSnapshot,
  });
  let attempted = false;
  const view = renderShippedState(state, {
    saveQueue: {
      async flushCase() {
        return true;
      },
      getEtag: () => 'e1',
    },
    client: {
      async patchCase() {
        attempted = true;
        return { ok: false, status: 412 };
      },
    },
  });

  fireEvent(
    getByRole(view.container, 'button', { name: 'Complete Case' }),
    'click'
  );
  await flush();

  // Without this the assertion below would also pass if `completionPatch`
  // returned null and no write was ever attempted — a rejected write is only
  // the subject if a write happened.
  assert.equal(attempted, true, 'the completion PATCH was attempted');
  assert.equal(
    view.state.routes.caseReview.snapshot.caseRow.status,
    'In-progress',
    'a rejected write must not leave the store claiming the Case is Completed'
  );
});

test('action: an Answer edited while the completion PATCH is in flight survives', async () => {
  // The whole reason the transition is folded in as a *field patch* rather than
  // as a replayed snapshot. The click handler's `snapshot`/`caseRow` are as of
  // the last render — two network round-trips (`flushCase`, then `patchCase`)
  // before this dispatch lands. Anything that reached the store in that window
  // would be reverted by a whole-snapshot replace, and the Answer-action owner
  // re-synced from the stale map on the next render, so the *next* edit would be
  // built on the stale base and enqueued — losing the edit in SharePoint too.
  const editedAnswers = { q1: { value: 'Yes' } };
  const loadedSnapshot = {
    ...snapshot(),
    machine: /** @type {any} */ ({
      canComplete: true,
      mayResolveRemediation: false,
      catalogue: [],
      transitionToCompleted: () => ({
        status: 'Completed',
        completedAt: '2026-07-19T12:00:00Z',
      }),
    }),
    allAnswered: true,
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadedSnapshot,
  });
  /** @type {any} */
  let view;
  view = renderShippedState(state, {
    saveQueue: {
      async flushCase() {
        return true;
      },
      getEtag: () => 'e1',
    },
    client: {
      async patchCase() {
        // Mid-flight: the Reviewer answers a Question while the write is out.
        view.dispatch({
          type: 'case/answers-edited',
          answers: editedAnswers,
        });
        return { ok: true, status: 200 };
      },
    },
  });

  fireEvent(
    getByRole(view.container, 'button', { name: 'Complete Case' }),
    'click'
  );
  await flush();

  const stored = view.state.routes.caseReview.snapshot;
  assert.equal(
    stored.caseRow.status,
    'Completed',
    'the lifecycle patch still lands'
  );
  assert.deepEqual(
    stored.answers,
    editedAnswers,
    'the concurrent Answer edit is not reverted by the completion dispatch'
  );
  assert.deepEqual(
    stored.caseRow.answers,
    editedAnswers,
    'and the row the next Answer edit is built from carries it too'
  );
});

test('action: a completion resolving after the mount is disposed dispatches nothing', async () => {
  const loadedSnapshot = {
    ...snapshot(),
    machine: /** @type {any} */ ({
      canComplete: true,
      mayResolveRemediation: false,
      catalogue: [],
      transitionToCompleted: () => ({ status: 'Completed' }),
    }),
    allAnswered: true,
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadedSnapshot,
  });
  /** @type {() => void} */
  let release = () => {};
  const inFlight = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  const view = renderShippedState(state, {
    saveQueue: {
      async flushCase() {
        return true;
      },
      getEtag: () => 'e1',
    },
    client: {
      async patchCase() {
        await inFlight;
        return { ok: true, status: 200 };
      },
    },
  });

  fireEvent(
    getByRole(view.container, 'button', { name: 'Complete Case' }),
    'click'
  );
  await flush();
  // The Reviewer navigates away while the write is still out.
  view.deactivate();
  const dispatched = view.actions.length;
  release();
  await flush();

  assert.equal(
    view.actions.length,
    dispatched,
    'neither the row patch nor the pending flag reaches a disposed mount'
  );
  assert.equal(
    view.state.routes.caseReview.snapshot.caseRow.status,
    'In-progress'
  );
});

test('action: a missing CaseMachine transition cannot dispatch completion', async () => {
  const loadedSnapshot = {
    ...snapshot(),
    machine: /** @type {any} */ ({
      canComplete: true,
      mayResolveRemediation: false,
    }),
    allAnswered: true,
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadedSnapshot,
  });
  let patches = 0;
  const view = renderShippedState(state, {
    saveQueue: {
      async flushCase() {
        return true;
      },
      getEtag: () => 'e1',
    },
    client: {
      async patchCase() {
        patches++;
        return { ok: true, status: 200 };
      },
    },
  });

  fireEvent(
    getByRole(view.container, 'button', { name: 'Complete Case' }),
    'click'
  );
  await flush();
  assert.equal(patches, 0);
  assert.equal(
    view.actions.some((action) => action.type === 'case/completion-pending'),
    false
  );
});

test('view: the completion button is disabled with its reason while remediation is unresolved', () => {
  const catalogue = [
    {
      id: 'q1',
      text: 'Question one',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  const answers = {
    q1: {
      value: 'No',
      remediationActions: [{ id: 'a1', text: 'Call back' }],
    },
  };
  const loadedSnapshot = {
    ...snapshot(),
    catalogue,
    applicableQuestions: catalogue,
    answers,
    machine: /** @type {any} */ ({
      canComplete: false,
      mayResolveRemediation: true,
    }),
    allAnswered: true,
  };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loadedSnapshot,
  });
  const view = renderShippedState(state);

  const button = /** @type {HTMLButtonElement} */ (
    getByRole(view.container, 'button', { name: 'Complete Case' })
  );
  assert.equal(button.disabled, true);
  // The reason travels with the button, so the gate is legible from any tab.
  assert.match(
    view.container.textContent ?? '',
    /before this Case can be completed/
  );
});

test('view: conflict state is surfaced with the existing reload warning', () => {
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  state = caseReviewReducer(state, {
    type: 'case/save-status-changed',
    status: 'conflict',
  });
  const view = renderShippedState(state).container;
  assert.match(getByRole(view, 'alert').textContent, /edited in another tab/);
  assert.equal(
    getByRole(view, 'button', { name: 'Reload' }).textContent,
    'Reload'
  );
  // The banner's placement is a stylesheet concern; what the page owes it
  // is the hook the stylesheet pins, and the banner rendered inside it.
  const status = view.querySelector('.cora-case-review__save-status');
  assert.ok(status, 'the save-status host carries its styling class');
  assert.ok(status.querySelector('.cora-banner-conflict'));
  assert.equal(status.getAttribute('style'), null, 'no inline positioning');
});

test('view: loading, error, denied, saving, and reconnecting states are explicit', () => {
  const initial = createInitialCaseReviewState(chrome);
  assert.match(renderShippedState(initial).container.textContent, /Loading/);

  const loaded = caseReviewReducer(initial, {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  const errorState = caseReviewReducer(initial, {
    type: 'case/load-finished',
    snapshot: { ...snapshot(), error: 'Case not found.' },
  });
  assert.match(
    renderShippedState(errorState).container.textContent,
    /Case not found/
  );
  const deniedState = caseReviewReducer(initial, {
    type: 'case/load-finished',
    snapshot: { ...snapshot(), accessDenied: true },
  });
  assert.match(
    renderShippedState(deniedState).container.textContent,
    /Access denied/
  );

  for (const [status, label] of /** @type {const} */ ([
    ['saving', 'Saving…'],
    ['reconnecting', 'Reconnecting…'],
  ])) {
    const statusState = caseReviewReducer(loaded, {
      type: 'case/save-status-changed',
      status,
    });
    assert.equal(
      getByRole(renderShippedState(statusState).container, 'status')
        .textContent,
      label
    );
  }
});

test('route: Notes and Conversation write through store-owned callbacks', async () => {
  const interactive = snapshot();
  interactive.machine = { canToggleConversation: true };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: interactive,
  });
  state = caseReviewReducer(state, { type: 'case/tab-selected', id: 'notes' });
  state = caseReviewReducer(state, { type: 'case/conversation-toggled' });

  /** @type {Array<{id: string, field: string, value: any}>} */
  const queued = [];
  /** @type {any[]} */
  const patches = [];
  const saveQueue = {
    enqueue(
      /** @type {string} */ id,
      /** @type {string} */ field,
      /** @type {any} */ value
    ) {
      queued.push({ id, field, value });
    },
    getEtag() {
      return 'e1';
    },
    loadCase() {},
  };
  const client = {
    async patchCase(
      /** @type {string} */ id,
      /** @type {any} */ fields,
      /** @type {string} */ etag
    ) {
      patches.push({ id, fields, etag });
      return { ok: true, status: 200, data: { ...caseRow, ...fields } };
    },
  };
  const view = renderShippedState(state, { client, saveQueue });
  const message = getByRole(view.container, 'textbox', {
    name: 'Message to Responsible Party',
  });
  message.value = 'Please review this.';
  fireEvent(
    getByRole(view.container, 'button', { name: 'Send message' }),
    'click'
  );
  await flush();
  assert.equal(patches[0].fields.conversation[0].body, 'Please review this.');
  assert.equal(
    view.state.routes.caseReview.snapshot.caseRow.conversation[0].body,
    'Please review this.'
  );

  const notes = getByRole(view.container, 'textbox', { name: 'Case notes' });
  notes.value = 'Store-owned note';
  fireEvent(notes, 'input');
  assert.deepEqual(queued, [
    { id: 'c1', field: 'notes', value: 'Store-owned note' },
  ]);
});

test('Notes effect: a Case field edit dispatches then enqueues against the loaded Case id', () => {
  /** @type {any[]} */
  const queued = [];
  /** @type {any[]} */
  const dispatched = [];
  let loadedCaseId = 'route-param';
  const save = createCaseReviewSaveEffect({
    saveQueue: /** @type {any} */ ({
      enqueue: (
        /** @type {string} */ id,
        /** @type {string} */ field,
        /** @type {any} */ value
      ) => queued.push({ id, field, value }),
    }),
    caseId: () => loadedCaseId,
    dispatch: (action) => dispatched.push(action),
  });

  // The effect is built before the Case loads, so the id it writes to is
  // whatever the getter resolves to at write time — not what it resolved to at
  // construction.
  loadedCaseId = 'c1';
  save.fieldEdited('notes', 'Store-owned note');
  save.fieldEdited('caseJustification', 'Because.');

  assert.deepEqual(queued, [
    { id: 'c1', field: 'notes', value: 'Store-owned note' },
    { id: 'c1', field: 'caseJustification', value: 'Because.' },
  ]);
  assert.deepEqual(dispatched, [
    { type: 'case/field-edited', field: 'notes', value: 'Store-owned note' },
    {
      type: 'case/field-edited',
      field: 'caseJustification',
      value: 'Because.',
    },
  ]);
});

test('Responsible Party effect: its own action and its own field write', () => {
  /** @type {any[]} */
  const queued = [];
  /** @type {any[]} */
  const dispatched = [];
  const save = createCaseReviewSaveEffect({
    saveQueue: /** @type {any} */ ({
      enqueue: (
        /** @type {string} */ id,
        /** @type {string} */ field,
        /** @type {any} */ value
      ) => queued.push({ id, field, value }),
    }),
    caseId: () => 'c1',
    dispatch: (action) => dispatched.push(action),
  });

  save.responsiblePartyChanged('jsmith', 'John Smith');

  assert.deepEqual(
    queued,
    [{ id: 'c1', field: 'responsibleParty', value: 'jsmith' }],
    'only the account is persisted — the name comes back with the next read'
  );
  assert.deepEqual(dispatched, [
    {
      type: 'case/responsible-party-changed',
      loginName: 'jsmith',
      displayName: 'John Smith',
    },
  ]);
});

test('Notes effect: `fieldEdited` takes only the plain-text Case fields — a type, not a convention', () => {
  /**
   * `fieldEdited` is the one *generic* Case Row writer: its reducer branch
   * assigns `[action.field]` onto `snapshot.caseRow`. `snapshot.machine` holds
   * its own load-time copy of the row, and every `machine.can*` guard reads
   * exactly `status` and `assignedReviewer` — so a caller writing either
   * through here would move the store's row while completion, capture,
   * capture and Remediation selection kept answering from the old one.
   *
   * The assertion here is `tsc`, not the runtime: each `@ts-expect-error`
   * fails the build with "Unused '@ts-expect-error' directive" the moment the
   * parameter widens back to `string`. Nothing is invoked — this is a
   * persistence path, and a nonsense write has no business reaching even a
   * stubbed queue.
   *
   * @param {ReturnType<typeof createCaseReviewSaveEffect>} save
   */
  const typeContract = (save) => {
    save.fieldEdited('notes', 'ok');
    save.fieldEdited('caseJustification', 'ok');
    // @ts-expect-error — `status` is a lifecycle field. It is written by
    // CaseMachine's transitions and folded in via `case/case-row-patched`.
    save.fieldEdited('status', 'Completed');
    // @ts-expect-error — `assignedReviewer` is the other field the machine's
    // guards read, and is not the Notes Section's to edit.
    save.fieldEdited('assignedReviewer', 'someone-else');
    // @ts-expect-error — `responsibleParty` resolves a Role, so it has its own
    // action and its own writer rather than riding the generic one.
    save.fieldEdited('responsibleParty', 'jsmith');
  };
  assert.equal(typeof typeContract, 'function');
});

test('the reducer ignores a case/field-edited for a field outside the plain-text pair', () => {
  // The type closes the effect seam, but `caseReviewReducer` takes `any`, so a
  // raw `tools.dispatch` from anywhere in the page still compiles. This is the
  // one branch that writes a computed key, so it is the last entrance: a
  // `status` write here would advance the row while every `machine.can*`
  // guard kept answering from its own load-time copy.
  const loaded = snapshot();
  loaded.caseRow = { ...loaded.caseRow, status: 'In-progress', notes: 'kept' };
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loaded,
  });

  const afterLifecycle = caseReviewReducer(state, {
    type: 'case/field-edited',
    field: 'status',
    value: 'Completed',
  });
  assert.equal(
    afterLifecycle.routes.caseReview.snapshot?.caseRow?.status,
    'In-progress',
    'a lifecycle field dispatched through the generic writer is ignored'
  );
  assert.equal(
    afterLifecycle,
    state,
    'and the state is returned unchanged, so nothing re-renders'
  );

  const afterNotes = caseReviewReducer(state, {
    type: 'case/field-edited',
    field: 'notes',
    value: 'edited',
  });
  assert.equal(
    afterNotes.routes.caseReview.snapshot?.caseRow?.notes,
    'edited',
    'the plain-text fields still write'
  );
});

test('the route writes to the loaded Case row id, not the route param that found it', () => {
  const loaded = snapshot();
  loaded.caseRow = { ...loaded.caseRow, id: 'c1' };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: loaded,
  });
  state = caseReviewReducer(state, { type: 'case/tab-selected', id: 'notes' });

  /** @type {any[]} */
  const queued = [];
  const saveQueue = {
    enqueue: (
      /** @type {string} */ id,
      /** @type {string} */ field,
      /** @type {any} */ value
    ) => queued.push({ id, field, value }),
  };
  // A route param that addresses the same row without being byte-identical to
  // its id — the only way the two can diverge (`#/case/…/C1` for item `c1`).
  const view = renderShippedState(state, { saveQueue }, undefined, {
    caseType: 'example-review',
    id: 'C1',
  });

  const notes = getByRole(view.container, 'textbox', { name: 'Case notes' });
  notes.value = 'Written against the loaded row';
  fireEvent(notes, 'input');

  // Without the re-sync in renderRoute this writes to 'C1', and SaveQueue would
  // create fresh state for that unknown id with an empty ETag — a write with no
  // concurrency guard rather than a loud failure.
  assert.deepEqual(queued, [
    { id: 'c1', field: 'notes', value: 'Written against the loaded row' },
  ]);
});

test('every persistence path addresses the loaded Case id, not the route param that found it', async () => {
  // The assertion that could not be made while the spellings disagreed: one
  // mount where the loaded row's id differs from `params.id`, driving every path
  // that names a Case id. The Conversation post was the live defect — it is
  // inline in the render function rather than in an effect, so the move onto the
  // accessor passed it by, and it posted a Message against the unresolved route
  // param. The Notes write is deliberately absent: it is already locked by the
  // test above, which owns that path.
  //
  // The mount uses `pending-config-review`, so the Case load parks before
  // `client.getCase` and never contributes a call of its own — the loader is
  // otherwise a legitimate reader of the route param, and every call recorded
  // below would be racing it.
  const transitionPatch = { status: 'Completed', completedAt: '2026-01-01' };
  const interactive = snapshot();
  interactive.caseRow = { ...interactive.caseRow, id: 'c1' };
  interactive.allAnswered = true;
  interactive.machine = /** @type {any} */ ({
    canToggleConversation: true,
    canComplete: true,
    mayResolveRemediation: false,
    transitionToCompleted: () => transitionPatch,
  });
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: interactive,
  });
  state = caseReviewReducer(state, { type: 'case/conversation-toggled' });

  /** @type {Array<[string, string]>} */
  const addressed = [];
  let read = 0;
  /** Every id addressed since the previous step, in call order. */
  const sinceLastStep = () => {
    const calls = addressed.slice(read);
    read = addressed.length;
    return calls;
  };
  const saveQueue = {
    async flushCase(/** @type {string} */ id) {
      addressed.push(['flushCase', id]);
      return true;
    },
    // Recorded, because the ETag read is the sharpest consequence of the bug:
    // an unknown id yields `''`, i.e. `If-Match: ''` — an unguarded write
    // rather than a loud failure.
    getEtag: (/** @type {string} */ id) => {
      addressed.push(['getEtag', id]);
      return 'e1';
    },
    loadCase: () => {},
  };
  const client = {
    async patchCase(/** @type {string} */ id, /** @type {any} */ fields) {
      addressed.push(['patchCase', id]);
      return { ok: true, status: 200, data: { ...caseRow, ...fields } };
    },
    async getCase(/** @type {string} */ id) {
      addressed.push(['getCase', id]);
      return { ...caseRow, conversation: [] };
    },
  };
  // A route param that addresses the same row without being byte-identical to
  // its id — `#/case/…/C1` for item `c1`.
  const view = renderShippedState(state, { client, saveQueue }, undefined, {
    caseType: 'pending-config-review',
    id: 'C1',
  });

  // 1. The Conversation Message post (the defect): a write.
  const message = getByRole(view.container, 'textbox', {
    name: 'Message to Responsible Party',
  });
  message.value = 'Please review this.';
  fireEvent(
    getByRole(view.container, 'button', { name: 'Send message' }),
    'click'
  );
  await flush();
  assert.deepEqual(
    sinceLastStep(),
    [
      ['getEtag', 'c1'],
      ['patchCase', 'c1'],
    ],
    'the Conversation Message is posted against the loaded row, not `params.id`'
  );

  // 2. Completion: the SaveQueue flush, the ETag read and the lifecycle PATCH.
  // Order-free: whether `completeCase` flushes before it PATCHes is its own
  // business, not this test's subject.
  fireEvent(
    getByRole(view.container, 'button', { name: 'Complete Case' }),
    'click'
  );
  await flush();
  assert.deepEqual(
    sinceLastStep()
      .map((call) => call.join(' '))
      .sort(),
    ['flushCase c1', 'getEtag c1', 'patchCase c1'],
    'completion flushes, guards and PATCHes the loaded row, not `params.id`'
  );

  // 3. The Conversation refresh on tab focus: a read of the same row.
  const onVisibilityChange = view.listeners.get('visibilitychange');
  assert.equal(typeof onVisibilityChange, 'function');
  /** @type {any} */ (onVisibilityChange)();
  await flush();
  assert.deepEqual(
    sinceLastStep(),
    [['getCase', 'c1']],
    'the Conversation refresh reads the loaded row, not `params.id`'
  );

  assert.equal(
    addressed.some(([, id]) => id === 'C1'),
    false,
    'no path anywhere reached for the route param'
  );
  view.dispose();
});

test('save effect: rapid Answer dispatches coalesce through unchanged SaveQueue', async () => {
  /** @type {any[]} */
  const patches = [];
  const client = {
    async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
      patches.push(fields);
      return {
        ok: true,
        status: 200,
        data: { ...caseRow, ...fields, etag: 'e2' },
      };
    },
    async getCase() {
      return caseRow;
    },
  };
  const queue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  queue.loadCase(/** @type {any} */ (caseRow));
  /** @type {any[]} */
  const dispatched = [];
  const save = createCaseReviewSaveEffect({
    saveQueue: queue,
    caseId: () => 'c1',
    dispatch: (action) => dispatched.push(action),
  });

  save.answersEdited({ q1: { value: 'Yes' } });
  save.answersEdited({ q1: { value: 'No' } });
  await queue.whenIdle();

  assert.deepEqual(patches, [{ answers: { q1: { value: 'No' } } }]);
  assert.deepEqual(
    dispatched.map((action) => action.type),
    ['case/answers-edited', 'case/answers-edited']
  );
});

test('On hold effect: queues the paired fields as one PATCH and clears the timestamp on release', async () => {
  /** @type {any[]} */
  const patches = [];
  const client = {
    async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
      patches.push(fields);
      return {
        ok: true,
        status: 200,
        data: { ...caseRow, ...fields, etag: `e${patches.length + 1}` },
      };
    },
    async getCase() {
      return caseRow;
    },
  };
  const queue = new SaveQueue(/** @type {any} */ (client), { debounceMs: 0 });
  queue.loadCase(/** @type {any} */ (caseRow));
  /** @type {any[]} */
  const dispatched = [];
  const save = createCaseReviewSaveEffect({
    saveQueue: queue,
    caseId: () => 'c1',
    dispatch: (action) => dispatched.push(action),
    now: () => new Date('2026-07-23T09:30:00.000Z'),
  });

  save.onHoldChanged(true);
  await queue.whenIdle();
  save.onHoldChanged(false);
  await queue.whenIdle();

  assert.deepEqual(patches, [
    {
      onHold: true,
      placedOnHoldAt: '2026-07-23T09:30:00.000Z',
    },
    { onHold: false, placedOnHoldAt: null },
  ]);
  assert.deepEqual(dispatched, [
    {
      type: 'case/on-hold-changed',
      onHold: true,
      placedOnHoldAt: '2026-07-23T09:30:00.000Z',
    },
    {
      type: 'case/on-hold-changed',
      onHold: false,
      placedOnHoldAt: null,
    },
  ]);
});

test('save effect: conflict status re-enters route state through dispatch', async () => {
  const queue = new SaveQueue(
    /** @type {any} */ ({
      async patchCase() {
        return { ok: false, status: 412 };
      },
      async getCase() {
        return {
          ...caseRow,
          answers: { remote: { value: 'changed' } },
          etag: 'e2',
        };
      },
    }),
    { debounceMs: 0 }
  );
  queue.loadCase(/** @type {any} */ (caseRow));
  /** @type {Array<'saved'|'saving'|'reconnecting'|'conflict'>} */
  const statuses = [];
  const dispose = observeSaveStatus(queue, (action) =>
    statuses.push(action.status)
  );

  queue.enqueue('c1', 'answers', { q1: { value: 'Yes' } });
  await queue.whenIdle();
  await flush();
  dispose();

  assert.deepEqual(statuses, ['saved', 'saving', 'conflict']);
});

test('route: mock-mode store shell keeps Review working at the existing URL', async () => {
  const qNeeds = exampleReviewConfig.questions.find(
    (question) => question.id === 'q-needs'
  );
  assert.ok(qNeeds);
  let storedRow = {
    ...caseRow,
    caseType: 'example-review',
    answers: { 'q-needs': { value: 'No' } },
  };
  /** @type {any[]} */
  const patches = [];
  const client = {
    async getCase() {
      return storedRow;
    },
    async getCurrentUser() {
      return chrome.currentUser;
    },
    async getExportHash() {
      return null;
    },
    async resolveUsers() {
      return {};
    },
    async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
      patches.push(fields);
      storedRow = { ...storedRow, ...fields, etag: 'e2' };
      return { ok: true, status: 200, data: storedRow };
    },
  };
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });
  const context = /** @type {any} */ ({
    client,
    saveQueue,
    currentUser: chrome.currentUser,
    capabilities: chrome.permissions,
    chrome,
  });
  const previousSearch = location.search;
  const previousHash = location.hash;
  location.search = '?mock=1';
  location.hash = '#/case/example-review/c1';
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    context
  );
  let state = slice.initialState;
  const container = document.createElement('main');
  /** @type {any} */
  let tools;
  tools = {
    render,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    listen(
      /** @type {EventTarget} */ target,
      /** @type {string} */ type,
      /** @type {EventListenerOrEventListenerObject} */ listener
    ) {
      target.addEventListener(type, listener);
    },
    isActive: () => true,
  };
  slice.render(container, state, tools);
  const dispose = slice.start?.(tools);
  await waitFor(
    () => state.routes.caseReview.snapshot?.loaded === true,
    'store-driven Case Review load'
  );

  assert.equal(state.routes.caseReview.snapshot?.loaded, true);
  // Appeal Review is not among them: this persona is a Reviewer, and the
  // Section is Controls-only. Neither is Appeal Request: that tab belongs to
  // the Case Type's configured appeal raiser, and a Reviewer never raises one.
  assert.equal(queryAllByRole(container, 'tab').length, 5);
  assert.match(container.textContent, /Ada Lovelace/);
  fireEvent(getByRole(container, 'tab', { name: 'Notes' }), 'click');
  assert.equal(state.routes.caseReview.activeTab, 'notes');
  assert.equal(location.hash, '#/case/example-review/c1');

  const reviewPanel = queryAllByRole(container, 'tabpanel').find(
    (panel) => panel.getAttribute('id') === 'case-panel-questions'
  );
  assert.ok(reviewPanel, 'store-driven Review panel remains mounted');
  fireEvent(answerOption(reviewPanel, 'q-welcome', 'Yes'), 'change');
  await saveQueue.whenIdle();
  await flush();

  assert.deepEqual(patches, [
    {
      answers: {
        'q-needs': { value: 'No' },
        'q-welcome': { value: 'Yes' },
      },
    },
  ]);
  assert.equal(state.routes.caseReview.saveStatus, 'saved');
  const allAnsweredBeforeGeneralQuestion =
    state.routes.caseReview.snapshot?.allAnswered;

  // A General Question travels the same Answer path: one namespaced key added
  // to the Answers blob, written by the same SaveQueue, leaving the Question
  // Definition answers and the computed Outcome untouched.
  const outcomeOf = () => {
    const snapshot = state.routes.caseReview.snapshot;
    assert.ok(snapshot?.config, 'loaded snapshot carries its Case Type config');
    return snapshot.config.computeOutcome(snapshot.answers);
  };
  const outcomeBefore = outcomeOf();
  const channel = getByRole(reviewPanel, 'combobox', {
    name: 'How was this Case reviewed?',
  });
  channel.value = 'Call recording';
  fireEvent(channel, 'change');
  await saveQueue.whenIdle();
  await flush();

  assert.deepEqual(patches[1], {
    answers: {
      'q-needs': { value: 'No' },
      'q-welcome': { value: 'Yes' },
      'general:reviewChannel': { value: 'Call recording' },
    },
  });
  assert.deepEqual(outcomeOf(), outcomeBefore);
  assert.equal(
    state.routes.caseReview.snapshot?.allAnswered,
    allAnsweredBeforeGeneralQuestion
  );

  fireEvent(getByRole(container, 'tab', { name: 'Issues' }), 'click');
  const issuesPanel = container.querySelector('#case-panel-issues');
  assert.equal(issuesPanel?.querySelector('cora-capture-groups'), null);
  const capture = /** @type {any} */ (
    issuesPanel?.querySelector('.cora-capture-input')
  );
  assert.ok(capture, 'configured Issue Capture field is rendered directly');
  capture.value = 'Agent rushed';
  fireEvent(capture, 'change');
  await saveQueue.whenIdle();
  await flush();

  assert.equal(
    issuesPanel?.querySelector('.cora-remediation-freeform-input'),
    null,
    'nothing to record until the Reviewer says remediation is required'
  );
  const requiredYes = /** @type {any} */ (
    issuesPanel?.querySelector('.cora-remediation-required-radio')
  );
  assert.ok(requiredYes, 'the Remediation Required decision is rendered');
  fireEvent(requiredYes, 'change');
  await saveQueue.whenIdle();
  await flush();

  const freeForm = /** @type {any} */ (
    issuesPanel?.querySelector('.cora-remediation-freeform-input')
  );
  assert.ok(freeForm, 'free-form Remediation Action input is rendered');
  freeForm.value = 'Coach the agent';
  fireEvent(freeForm, 'change');
  await saveQueue.whenIdle();
  await flush();

  const action = /** @type {any} */ (
    issuesPanel?.querySelector('.cora-remediation-action-checkbox')
  );
  assert.ok(action, 'configured Remediation Action is rendered');
  action.checked = true;
  fireEvent(action, 'change');
  await saveQueue.whenIdle();
  await flush();

  const savedAnswer = /** @type {any} */ (patches.at(-1)?.answers?.['q-needs']);
  assert.ok(savedAnswer);
  assert.deepEqual(savedAnswer.remediationActions, [
    {
      id: 'q-needs-ra-0',
      text: 'Retrain agent on needs-identification protocol.',
    },
  ]);
  assert.deepEqual(savedAnswer.capture, {
    rootCause: 'Agent rushed',
  });
  assert.equal(savedAnswer.freeFormRemediation, 'Coach the agent');
  assert.equal(savedAnswer.remediationRequired, 'yes');

  const onHold = getByRole(container, 'button', { name: 'On hold' });
  assert.equal(onHold.getAttribute('aria-pressed'), 'false');
  fireEvent(onHold, 'click');
  await saveQueue.whenIdle();
  await flush();
  const holdPatch = /** @type {any} */ (patches.at(-1));
  assert.equal(holdPatch?.onHold, true);
  assert.equal(typeof holdPatch?.placedOnHoldAt, 'string');
  assert.equal(
    getByRole(container, 'button', { name: 'On hold' }).getAttribute(
      'aria-pressed'
    ),
    'true'
  );

  fireEvent(getByRole(container, 'button', { name: 'On hold' }), 'click');
  await saveQueue.whenIdle();
  await flush();
  assert.deepEqual(patches.at(-1), {
    onHold: false,
    placedOnHoldAt: null,
  });

  const patchCountBeforeRapidToggle = patches.length;
  const rapidToggle = getByRole(container, 'button', { name: 'On hold' });
  fireEvent(rapidToggle, 'click');
  fireEvent(rapidToggle, 'click');
  await saveQueue.whenIdle();
  await flush();
  assert.equal(patches.length, patchCountBeforeRapidToggle + 1);
  assert.deepEqual(patches.at(-1), {
    onHold: false,
    placedOnHoldAt: null,
  });
  assert.equal(
    getByRole(container, 'button', { name: 'On hold' }).getAttribute(
      'aria-pressed'
    ),
    'false'
  );

  if (typeof dispose === 'function') dispose();
  location.search = previousSearch;
  location.hash = previousHash;
});

test('route: a rejected save surfaces the conflict banner in the mounted page', async () => {
  let storedRow = {
    ...caseRow,
    caseType: 'example-review',
    answers: { 'q-needs': { value: 'No' } },
  };
  const client = {
    async getCase() {
      return storedRow;
    },
    async getCurrentUser() {
      return chrome.currentUser;
    },
    async getExportHash() {
      return null;
    },
    async resolveUsers() {
      return {};
    },
    async patchCase() {
      return { ok: false, status: 412 };
    },
  };
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });
  const context = /** @type {any} */ ({
    client,
    saveQueue,
    currentUser: chrome.currentUser,
    capabilities: chrome.permissions,
    chrome,
  });
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    context
  );
  let state = slice.initialState;
  const container = document.createElement('main');
  /** @type {any} */
  let tools;
  tools = {
    render,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    listen(
      /** @type {EventTarget} */ target,
      /** @type {string} */ type,
      /** @type {EventListenerOrEventListenerObject} */ listener
    ) {
      target.addEventListener(type, listener);
    },
    isActive: () => true,
  };

  let dispose;
  try {
    slice.render(container, state, tools);
    dispose = slice.start?.(tools);
    await waitFor(
      () => state.routes.caseReview.snapshot?.loaded === true,
      'store-driven Case Review load'
    );

    // Divergent remote Answers are what make the stale ETag a conflict the
    // Reviewer must see, rather than a write the queue can silently retry.
    storedRow = {
      ...storedRow,
      answers: { 'q-needs': { value: 'Yes' } },
      etag: 'e2',
    };

    fireEvent(answerOption(container, 'q-welcome', 'Yes'), 'change');
    await saveQueue.whenIdle();
    await flush();

    assert.equal(state.routes.caseReview.saveStatus, 'conflict');
    const banner = container.querySelector('.cora-banner-conflict');
    assert.ok(banner, 'the rejected write reaches the page as a banner');
    assert.equal(banner.getAttribute('role'), 'alert');
    assert.equal(banner.getAttribute('aria-live'), 'assertive');
    assert.match(container.textContent, /edited in another tab/);
  } finally {
    if (typeof dispose === 'function') dispose();
  }
});

test('route: the Remediation tab resolves a Question through the store seam', async () => {
  let storedRow = {
    ...caseRow,
    status: 'Actions In Progress',
    caseType: 'example-review',
    answers: {
      'q-needs': {
        value: 'No',
        remediationActions: [{ id: 'sent-1', text: 'Coach the agent' }],
      },
    },
  };
  /** @type {any[]} */
  const patches = [];
  const client = {
    async getCase() {
      return storedRow;
    },
    async getCurrentUser() {
      return chrome.currentUser;
    },
    async getExportHash() {
      return null;
    },
    async resolveUsers() {
      return {};
    },
    async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
      patches.push(fields);
      storedRow = { ...storedRow, ...fields, etag: 'e2' };
      return { ok: true, status: 200, data: storedRow };
    },
  };
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });
  const context = /** @type {any} */ ({
    client,
    saveQueue,
    currentUser: chrome.currentUser,
    capabilities: chrome.permissions,
    chrome,
  });
  const previousSearch = location.search;
  const previousHash = location.hash;
  location.search = '?mock=1';
  location.hash = '#/case/example-review/c1';
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    context
  );
  let state = slice.initialState;
  const container = document.createElement('main');
  /** @type {any} */
  let tools;
  tools = {
    render,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    listen(
      /** @type {EventTarget} */ target,
      /** @type {string} */ type,
      /** @type {EventListenerOrEventListenerObject} */ listener
    ) {
      target.addEventListener(type, listener);
    },
    isActive: () => true,
  };

  let dispose;
  try {
    slice.render(container, state, tools);
    dispose = slice.start?.(tools);
    await waitFor(
      () => state.routes.caseReview.snapshot?.loaded === true,
      'store-driven remediation tracking load'
    );

    fireEvent(getByRole(container, 'tab', { name: 'Remediation' }), 'click');
    const status = /** @type {any} */ (
      container.querySelector('.cora-tracking-status-select')
    );
    assert.ok(status, 'the resolution control is rendered');
    status.value = 'complete';
    fireEvent(status, 'change');
    await saveQueue.whenIdle();
    await flush();

    assert.deepEqual(
      patches.at(-1)?.answers?.['q-needs']?.remediationStatus,
      { status: 'complete' },
      JSON.stringify(patches)
    );
  } finally {
    if (typeof dispose === 'function') dispose();
    location.search = previousSearch;
    location.hash = previousHash;
  }
});

test('route: a read-only Reviewer on a reportable Case writes no Answer', async () => {
  // The single Answer writer is only as safe as the guards it is handed. A
  // Completed Case is read-only for its Reviewer, so the Review tab still
  // renders its controls — disabled — and firing one must reach neither the
  // store nor the SaveQueue.
  const storedRow = {
    ...caseRow,
    status: 'Completed',
    completedAt: '2026-01-01T00:00:00Z',
    caseType: 'example-review',
    answers: { 'q-needs': { value: 'No' } },
  };
  /** @type {any[]} */
  const patches = [];
  const client = {
    async getCase() {
      return storedRow;
    },
    async getCurrentUser() {
      return chrome.currentUser;
    },
    async getExportHash() {
      return null;
    },
    async getVersionedExport() {
      return null;
    },
    async resolveUsers() {
      return {};
    },
    async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
      patches.push(fields);
      return { ok: true, status: 200, data: storedRow };
    },
  };
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    /** @type {any} */ ({
      client,
      saveQueue,
      currentUser: chrome.currentUser,
      capabilities: chrome.permissions,
      chrome,
    })
  );
  let state = slice.initialState;
  const container = document.createElement('main');
  /** @type {any} */
  let tools;
  tools = {
    render,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    listen() {},
    isActive: () => true,
  };

  let dispose;
  try {
    slice.render(container, state, tools);
    dispose = slice.start?.(tools);
    await waitFor(
      () => state.routes.caseReview.snapshot?.loaded === true,
      'store-driven read-only Case Review load'
    );

    const snapshot = state.routes.caseReview.snapshot;
    assert.equal(snapshot?.access.questions, 'read-only');
    assert.equal(snapshot?.machine?.canEditIssues, false);

    // The Review tab still renders its (disabled) controls.
    const option = answerOption(container, 'q-welcome', 'Yes');
    fireEvent(option, 'change');
    await saveQueue.whenIdle();
    await flush();

    assert.deepEqual(patches, [], 'no Answer reaches the SaveQueue');
    assert.deepEqual(
      state.routes.caseReview.snapshot?.answers,
      storedRow.answers,
      'and none reaches the store'
    );
  } finally {
    if (typeof dispose === 'function') dispose();
  }
});

test('route: sequential Answer edits accumulate', async () => {
  // The main reviewer flow: answer one Question, then another, then another.
  // Question cards are memoised on `[answer, access]`, so an edit rebuilds only
  // its own card; every other card keeps the `onchange` closure from the
  // previous render. A callback that captured that render's Answers would
  // compute each edit against Answers as they stood before the *first* one and
  // write the result straight through the whole-blob PATCH.
  //
  // Three edits, starting from one pre-answered Question, because the loss has
  // two shapes and only the second is obvious:
  //   - `q-channel` is already answered, so re-answering it silently reverts to
  //     the stored value — the key survives, which hides the bug from any
  //     key-only assertion.
  //   - `q-welcome` is then dropped outright by the `q-needs` edit.
  // The three Questions are independent in the fixture bank, which is what
  // keeps the untouched cards cached.
  let storedRow = {
    ...caseRow,
    caseType: 'example-review',
    answers: { 'q-channel': { value: 'Email' } },
  };
  /** @type {any[]} */
  const patches = [];
  const client = {
    async getCase() {
      return storedRow;
    },
    async getCurrentUser() {
      return chrome.currentUser;
    },
    async getExportHash() {
      return null;
    },
    async resolveUsers() {
      return {};
    },
    async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
      patches.push(fields);
      storedRow = { ...storedRow, ...fields, etag: 'e2' };
      return { ok: true, status: 200, data: storedRow };
    },
  };
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    /** @type {any} */ ({
      client,
      saveQueue,
      currentUser: chrome.currentUser,
      capabilities: chrome.permissions,
      chrome,
    })
  );
  let state = slice.initialState;
  const container = document.createElement('main');
  /** @type {any} */
  let tools;
  tools = {
    render,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    listen() {},
    isActive: () => true,
  };

  let dispose;
  try {
    slice.render(container, state, tools);
    dispose = slice.start?.(tools);
    await waitFor(
      () => state.routes.caseReview.snapshot?.loaded === true,
      'store-driven Case Review load'
    );

    for (const [questionId, option] of [
      ['q-channel', 'Phone'], // over the stored Email
      ['q-welcome', 'Yes'],
      ['q-needs', 'Yes'],
    ]) {
      fireEvent(answerOption(container, questionId, option), 'change');
      await saveQueue.whenIdle();
      await flush();
    }

    const accumulated = {
      'q-channel': { value: 'Phone' },
      'q-welcome': { value: 'Yes' },
      'q-needs': { value: 'Yes' },
    };
    assert.deepEqual(
      patches.at(-1),
      { answers: accumulated },
      'each edit is written on top of the last, not instead of it'
    );
    assert.deepEqual(state.routes.caseReview.snapshot?.answers, accumulated);
  } finally {
    if (typeof dispose === 'function') dispose();
  }
});

test('route: the Remediation Required decision writes through the single Answer effect', async () => {
  // The decision is an Answer edit like any other, and "No" is the one edit
  // that takes something away: the actions the Reviewer had already ticked go
  // with it, so the stored Answer never claims remediation the Reviewer has
  // said is not needed.
  let storedRow = {
    ...caseRow,
    caseType: 'example-review',
    answers: { 'q-needs': { value: 'No' } },
  };
  /** @type {any[]} */
  const patches = [];
  const client = {
    async getCase() {
      return storedRow;
    },
    async getCurrentUser() {
      return chrome.currentUser;
    },
    async getExportHash() {
      return null;
    },
    async resolveUsers() {
      return {};
    },
    async patchCase(/** @type {string} */ _id, /** @type {any} */ fields) {
      patches.push(fields);
      storedRow = { ...storedRow, ...fields, etag: 'e2' };
      return { ok: true, status: 200, data: storedRow };
    },
  };
  const saveQueue = new SaveQueue(/** @type {any} */ (client), {
    debounceMs: 0,
  });
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    /** @type {any} */ ({
      client,
      saveQueue,
      currentUser: chrome.currentUser,
      capabilities: chrome.permissions,
      chrome,
    })
  );
  let state = slice.initialState;
  const container = document.createElement('main');
  /** @type {any} */
  let tools;
  tools = {
    render,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    listen() {},
    isActive: () => true,
  };

  let dispose;
  try {
    slice.render(container, state, tools);
    dispose = slice.start?.(tools);
    await waitFor(
      () => state.routes.caseReview.snapshot?.loaded === true,
      'store-driven Case Review load'
    );
    tools.dispatch({ type: 'case/tab-selected', id: 'issues' });

    const radio = (/** @type {number} */ index) => {
      const radios = container
        .querySelector('#case-panel-issues')
        ?.querySelectorAll('.cora-remediation-required-radio');
      assert.ok(radios);
      assert.equal(radios.length, 2, 'the decision renders for the failure');
      return /** @type {any} */ (radios[index]);
    };

    fireEvent(radio(0), 'change');
    await saveQueue.whenIdle();
    await flush();
    assert.equal(
      state.routes.caseReview.snapshot?.answers['q-needs']?.remediationRequired,
      'yes'
    );

    const action = /** @type {any} */ (
      container
        .querySelector('#case-panel-issues')
        ?.querySelector('.cora-remediation-action-checkbox')
    );
    assert.ok(action, 'Yes reveals the configured Remediation Actions');
    action.checked = true;
    fireEvent(action, 'change');
    await saveQueue.whenIdle();
    await flush();
    assert.equal(
      patches.at(-1)?.answers?.['q-needs']?.remediationActions?.length,
      1
    );

    fireEvent(radio(1), 'change');
    await saveQueue.whenIdle();
    await flush();
    assert.deepEqual(patches.at(-1)?.answers?.['q-needs'], {
      value: 'No',
      remediationRequired: 'no',
    });
  } finally {
    if (typeof dispose === 'function') dispose();
  }
});

test('view: the Summary rolls up the Reviewer’s General Question answers', () => {
  const generalSnapshot = snapshot();
  generalSnapshot.config.generalQuestions = [
    { key: 'reviewChannel', label: 'How was this reviewed?', type: 'select' },
    { key: 'observations', label: 'Observations', type: 'textarea' },
  ];
  generalSnapshot.answers = {
    ...generalSnapshot.answers,
    'general:observations': { value: 'Nothing systemic here' },
  };

  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: generalSnapshot,
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'summary',
  });

  const panel = renderShippedState(state).container.querySelector(
    '#case-panel-summary'
  );
  assert.match(panel?.textContent ?? '', /ObservationsNothing systemic here/);
  // Unanswered ones stay out rather than showing an empty row.
  assert.doesNotMatch(panel?.textContent ?? '', /How was this reviewed\?/);
});

test('the Review tab and the Summary put General Questions on the same side, for every placement value', () => {
  // One resolver, two consumers. The interesting inputs are the two legal
  // values, an absent one (the default), and an out-of-vocabulary one — which
  // used to be the case where the two views could disagree, because the Review
  // tab passed a typo straight through while the Summary read it as 'after'.
  /** @param {unknown} placement */
  const sidesFor = (placement) => {
    const generalSnapshot = snapshot();
    generalSnapshot.config.generalQuestions = [
      { key: 'observations', label: 'Observations', type: 'textarea' },
    ];
    generalSnapshot.config.generalQuestionsPlacement = placement;
    generalSnapshot.answers = {
      ...generalSnapshot.answers,
      'general:observations': { value: 'Nothing systemic here' },
    };

    const { container } = renderShippedState(
      caseReviewReducer(createInitialCaseReviewState(chrome), {
        type: 'case/load-finished',
        snapshot: generalSnapshot,
      })
    );

    /**
     * Document-order position of the first element carrying `className`, or -1.
     * @param {any} root
     * @param {string} className
     */
    const positionOf = (root, className) => {
      let seen = 0;
      let found = -1;
      /** @param {any} node */
      const walk = (node) => {
        for (const child of node.childNodes ?? []) {
          seen += 1;
          if (
            found === -1 &&
            String(child.className ?? '')
              .split(' ')
              .includes(className)
          ) {
            found = seen;
          }
          walk(child);
        }
      };
      walk(root);
      return found;
    };

    /**
     * Which side of the anchor block the General Questions sit on, read from
     * the rendered order rather than from any placement value.
     * @param {string} panelId
     * @param {string} generalClass
     * @param {string} anchorClass
     */
    const side = (panelId, generalClass, anchorClass) => {
      const panel = container.querySelector(`#case-panel-${panelId}`);
      const general = positionOf(panel, generalClass);
      const anchor = positionOf(panel, anchorClass);
      assert.ok(general > 0, `${panelId} renders the General Questions`);
      assert.ok(anchor > 0, `${panelId} renders the anchor block`);
      return general < anchor ? 'before' : 'after';
    };

    return {
      review: side(
        'questions',
        'cora-general-questions',
        'cora-question-panel'
      ),
      summary: side(
        'summary',
        'cora-summary-general-questions',
        'cora-summary-details'
      ),
    };
  };

  assert.deepEqual(sidesFor('before'), { review: 'before', summary: 'before' });
  assert.deepEqual(sidesFor('after'), { review: 'after', summary: 'after' });
  assert.deepEqual(sidesFor(undefined), { review: 'after', summary: 'after' });
  assert.deepEqual(sidesFor('beneath'), { review: 'after', summary: 'after' });
});

test('panel map: a tab switch keeps every panel mounted and its nodes identical', () => {
  const view = renderShippedState(
    caseReviewReducer(createInitialCaseReviewState(chrome), {
      type: 'case/load-finished',
      snapshot: snapshot(),
    })
  );
  view.dispatch({ type: 'case/tab-selected', id: 'notes' });
  const notesPanel = /** @type {any} */ (
    view.container.querySelector('#case-panel-notes')
  );
  const notesField = queryAllByRole(
    /** @type {any} */ (notesPanel),
    'textbox'
  )[0];
  assert.ok(notesField, 'the Notes panel renders an editable field');

  // Caret and focus survive a tab switch only because panels stay in the DOM
  // and render() patches them in place. Node identity is the mechanism: a
  // re-created field would render identically and lose the caret silently.
  view.dispatch({ type: 'case/tab-selected', id: 'summary' });
  assert.equal(notesPanel?.hidden, true, 'the Notes panel is hidden, not gone');
  view.dispatch({ type: 'case/tab-selected', id: 'notes' });
  assert.equal(
    view.container.querySelector('#case-panel-notes'),
    notesPanel,
    'the same panel element comes back'
  );
  assert.equal(
    queryAllByRole(/** @type {any} */ (notesPanel), 'textbox')[0],
    notesField,
    'the same field element comes back'
  );
  assert.equal(notesPanel?.hidden, false);
  view.dispose();
});

// The banner is present from the first render and never changes, so the
// live-region attributes will not announce anything — a live region has to be in
// the DOM before its contents change. They are kept because they cost nothing and
// correctly describe the node's role; what this test checks is the banner's
// presence, copy and attributes, not an announcement.
test('a Case whose as-reviewed Question Bank is unavailable renders a status-role warning banner', () => {
  const warned = snapshot();
  warned.caseRow = { ...warned.caseRow, status: 'Reported' };
  warned.versionWarning = 'as-reviewed version unavailable';
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: warned,
  });
  const view = renderShippedState(state);
  const banner = view.container.querySelector('.cora-banner-warning');
  assert.ok(banner, 'the version warning is rendered');
  assert.equal(banner.getAttribute('role'), 'status');
  assert.equal(banner.getAttribute('aria-live'), 'polite');
  assert.match(banner.textContent, /as-reviewed Question Bank/);
  assert.match(banner.textContent, /current Question Bank/);
  view.dispose();
});

test('a Case with a resolved as-reviewed snapshot renders no warning', () => {
  const resolved = snapshot();
  resolved.caseRow = { ...resolved.caseRow, status: 'Reported' };
  resolved.versionWarning = null;
  resolved.exportHash = 'abc123';
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: resolved,
  });
  const view = renderShippedState(state);
  assert.equal(view.container.querySelector('.cora-banner-warning'), null);
  view.dispose();
});

test('an In-progress Case renders no version warning', () => {
  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: snapshot(),
  });
  const view = renderShippedState(state);
  assert.equal(view.container.querySelector('.cora-banner-warning'), null);
  view.dispose();
});

/**
 * Start the real route slice against a Case load the test releases by hand, so
 * the mount lifetime can be ended while the load is still in flight.
 * @param {{ getCase: (...args: any[]) => Promise<any> }} clientOverrides
 */
function startPendingLoadRoute(clientOverrides) {
  const client = /** @type {any} */ ({
    getCurrentUser: async () => chrome.currentUser,
    getExportHash: async () => null,
    getVersionedExport: async () => null,
    resolveUsers: async () => ({}),
    searchPeople: async () => [],
    ...clientOverrides,
  });
  const saveQueue = new SaveQueue(client, { debounceMs: 0 });
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    /** @type {any} */ ({ client, saveQueue, chrome })
  );
  /** @type {any[]} */
  const actions = [];
  /** @type {Map<string, Function>} */
  const listeners = new Map();
  let active = true;
  const teardown = slice.start(
    /** @type {any} */ ({
      render,
      dispatch: (/** @type {any} */ action) => actions.push(action),
      listen: captureListeners(listeners),
      isActive: () => active,
    })
  );
  return {
    actions,
    listeners,
    dispose() {
      active = false;
      teardown?.();
    },
  };
}

/** A promise the test releases by hand, created before the route asks for it. */
function deferred() {
  /** @type {(value: any) => void} */
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * Drain the awaited turns of the Case load. Microtasks only, and every test
 * using it also asserts the still-mounted control route did dispatch, so a
 * drain that were too short would fail the test rather than fake a pass.
 */
async function drain() {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
}

test('Alt+C toggles the Conversation panel from the document keydown shortcut', () => {
  const route = startPendingLoadRoute({ getCase: () => new Promise(() => {}) });
  const onKeydown = route.listeners.get('keydown');
  assert.equal(typeof onKeydown, 'function');
  const press = (/** @type {any} */ event) =>
    /** @type {any} */ (onKeydown)(event);

  press({ altKey: true, code: 'KeyC' });
  // Neither half of the shortcut alone toggles anything.
  press({ altKey: false, code: 'KeyC' });
  press({ altKey: true, code: 'KeyD' });

  assert.deepEqual(
    route.actions.filter(
      (action) => action.type === 'case/conversation-toggled'
    ),
    [{ type: 'case/conversation-toggled' }],
    'only Alt+C toggles, and it toggles once per press'
  );
  route.dispose();
});

test('a Case load resolving after unmount dispatches nothing', async () => {
  const pendingMounted = deferred();
  const mounted = startPendingLoadRoute({
    getCase: () => pendingMounted.promise,
  });
  const pendingUnmounted = deferred();
  const unmounted = startPendingLoadRoute({
    getCase: () => pendingUnmounted.promise,
  });
  unmounted.dispose();

  pendingMounted.release({ ...caseRow });
  pendingUnmounted.release({ ...caseRow });
  await drain();

  assert.equal(
    mounted.actions.some((action) => action.type === 'case/load-finished'),
    true,
    'the still-mounted route must finish its load'
  );
  assert.deepEqual(
    unmounted.actions.filter((action) => action.type === 'case/load-finished'),
    []
  );
  mounted.dispose();
});

test('a conversation refresh resolving after unmount dispatches nothing', async () => {
  // The visibilitychange handler is invoked synchronously below, before the
  // Case load has finished awaiting its Case Type config — so the refresh is
  // the first `getCase` and the load, which stays pending, is the second.
  /** @param {Promise<any>} refresh */
  const startRefreshRoute = (refresh) => {
    let calls = 0;
    return startPendingLoadRoute({
      getCase: () => (++calls === 1 ? refresh : new Promise(() => {})),
    });
  };
  const pendingMounted = deferred();
  const mounted = startRefreshRoute(pendingMounted.promise);
  const pendingUnmounted = deferred();
  const unmounted = startRefreshRoute(pendingUnmounted.promise);

  for (const route of [mounted, unmounted]) {
    const onVisibilityChange = route.listeners.get('visibilitychange');
    assert.equal(typeof onVisibilityChange, 'function');
    /** @type {any} */ (onVisibilityChange)();
  }
  unmounted.dispose();

  const row = { ...caseRow, conversation: [{ id: 'm1' }] };
  pendingMounted.release(row);
  pendingUnmounted.release(row);
  await drain();

  assert.equal(
    mounted.actions.some(
      (action) => action.type === 'case/conversation-changed'
    ),
    true,
    'the still-mounted route must apply the refreshed Conversation'
  );
  assert.deepEqual(
    unmounted.actions.filter(
      (action) => action.type === 'case/conversation-changed'
    ),
    []
  );
  mounted.dispose();
});

test('conversationPanelMode reads the query string it is given', () => {
  assert.equal(conversationPanelMode('?conversation=sidebar'), 'sidebar');
  assert.equal(
    conversationPanelMode('?mock=1'),
    'popover',
    'no ?conversation= is the popover default'
  );
  assert.equal(conversationPanelMode(''), 'popover');
});

test('conversationPanelMode defaults to the current page query string', () => {
  // The `globalThis.location?.` default is what replaced the
  // `typeof location === 'undefined'` sniff, so the no-location case is
  // the branch that has to be exercised — a Node harness driving Case Review
  // has no `location` at all. Same shape as tests/question-bank-flags.test.js,
  // the precedent this default follows.
  const original = /** @type {any} */ (globalThis).location;
  try {
    /** @type {any} */ (globalThis).location = {
      search: '?conversation=sidebar',
    };
    assert.equal(conversationPanelMode(), 'sidebar');
    /** @type {any} */ (globalThis).location = { search: '' };
    assert.equal(conversationPanelMode(), 'popover');
    /** @type {any} */ (globalThis).location = undefined;
    assert.equal(
      conversationPanelMode(),
      'popover',
      'no location at all still resolves the Conversation default'
    );
  } finally {
    /** @type {any} */ (globalThis).location = original;
  }
});

test('route: the header Conversation button toggles the Conversation panel', () => {
  const toggleSnapshot = snapshot();
  toggleSnapshot.machine = { canToggleConversation: true };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: toggleSnapshot,
  });

  const { container, actions } = renderShippedState(state);
  const host = /** @type {any} */ (
    container.querySelector('.cora-case-review__conversation')
  );
  // The Conversation starts collapsed on every load, so the button is
  // the only way in.
  assert.equal(host.hidden, true);

  fireEvent(
    getByRole(container, 'button', {
      name: 'Toggle conversation panel (⌥C / Alt+C)',
    }),
    'click'
  );
  assert.deepEqual(actions, [{ type: 'case/conversation-toggled' }]);
  assert.equal(host.hidden, false, 'the panel the button dispatched for opens');
});

/** A Case whose one applicable Question failed and carries a Remediation Action. */
function remediationSnapshot() {
  const answers = {
    q1: {
      value: 'No',
      remediationRequired: 'yes',
      remediationActions: [{ id: 'q1-ra-0', text: 'Fix it' }],
    },
  };
  const catalogue = [
    {
      id: 'q1',
      text: 'Question one',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      remediationActions: ['Fix it'],
      deprecated: false,
    },
  ];
  const base = snapshot();
  return {
    ...base,
    answers,
    catalogue,
    applicableQuestions: catalogue,
    caseRow: { ...caseRow, status: 'Actions In Progress', answers },
    access: { ...base.access, remediation: 'read-only' },
    machine: { canToggleConversation: true, roles: ['responsibleParty'] },
  };
}

test('route: the Remediation tab’s Open conversation button opens the Conversation panel', () => {
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: remediationSnapshot(),
  });
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'remediation',
  });

  const { container, actions } = renderShippedState(state);
  const host = /** @type {any} */ (
    container.querySelector('.cora-case-review__conversation')
  );
  assert.equal(host.hidden, true);

  const open = container
    .querySelector('#case-panel-remediation')
    ?.querySelector('.cora-remediation-conversation-btn');
  assert.ok(open, 'the Remediation pointer to the Conversation is rendered');
  fireEvent(open, 'click');
  assert.deepEqual(actions, [{ type: 'case/conversation-toggled' }]);
  assert.equal(host.hidden, false);
});

test('route: collapsing an Issue Capture Group dispatches the route’s toggle action', () => {
  const base = remediationSnapshot();
  const captureSnapshot = {
    ...base,
    access: { ...base.access, issues: 'edit' },
    machine: { canEditIssues: true },
    config: {
      ...base.config,
      captureGroups: [
        {
          key: 'context',
          label: 'Context',
          collapsed: false,
          fields: [{ key: 'summary', label: 'What happened', type: 'text' }],
        },
      ],
    },
  };
  let state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: captureSnapshot,
  });
  state = caseReviewReducer(state, { type: 'case/tab-selected', id: 'issues' });

  const { container, actions } = renderShippedState(state);
  /** @returns {any} */
  const group = () =>
    container
      .querySelector('#case-panel-issues')
      ?.querySelector('.cora-capture-group-header');
  assert.equal(group()?.getAttribute('aria-expanded'), 'true');

  fireEvent(group(), 'click');
  assert.deepEqual(actions, [
    {
      type: 'case/capture-group-toggled',
      questionId: 'q1',
      groupKey: 'context',
      collapsed: true,
    },
  ]);
  assert.equal(
    group()?.getAttribute('aria-expanded'),
    'false',
    'the group the click dispatched for is the group that collapsed'
  );
});

test('case review slice: navigating away aborts the in-flight Case read with no error UI', async () => {
  const controller = new AbortController();
  let aborted = false;
  /** @type {any[]} */
  const actions = [];
  // No `caseType` param, so `CaseLoader.load()` skips the manifest and parks on
  // the Case read itself — which settles only when the caller aborts.
  const context = /** @type {any} */ ({
    client: {
      getCase: (/** @type {any} */ _id, /** @type {any} */ opts = {}) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(opts.signal.reason);
          });
        }),
      getCurrentUser: async () => ({ id: 'reviewer', groups: [] }),
    },
    saveQueue: { subscribeStatus: () => () => {} },
    chrome: { currentUser: { id: 'reviewer' }, permissions: {} },
  });
  const slice = createRouteSlice({ id: 'c1' }, context);

  slice.start(
    /** @type {any} */ ({
      context,
      params: { id: 'c1' },
      dispatch: (/** @type {any} */ action) => actions.push(action),
      listen: () => {},
      isActive: () => !controller.signal.aborted,
      signal: controller.signal,
    })
  );
  controller.abort();

  // An unhandled AbortError rejection fails the run under `node --test`, so
  // draining here also proves the load handles its own abort.
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.equal(aborted, true, 'the in-flight Case read was cancelled');
  assert.equal(
    actions.some((action) => action.type === 'case/load-finished'),
    false,
    'the aborted load hands no snapshot to the store'
  );
});

test('case review slice: the read carries the signal while the write path keeps the raw client', async () => {
  /** @type {any} */
  let readOptions = null;
  /** @type {any[]} */
  const loadedByQueue = [];
  const readRow = makeCaseRow({
    id: 'c1',
    caseType: 'example-review',
    assignedReviewer: 'reviewer',
  });
  const context = /** @type {any} */ ({
    client: {
      getCase: async (/** @type {any} */ _id, /** @type {any} */ opts = {}) => {
        readOptions = opts;
        return readRow;
      },
      getCurrentUser: async () => ({ id: 'reviewer', groups: [] }),
      getExportHash: async () => null,
    },
    // Writes are never cancelled: the queue is handed the Case Row
    // by the loader and holds the boot-built client, not the read wrapper.
    saveQueue: {
      subscribeStatus: () => () => {},
      loadCase: (/** @type {any} */ row) => loadedByQueue.push(row),
    },
    chrome: {
      currentUser: chrome.currentUser,
      permissions: chrome.permissions,
    },
  });
  const signal = new AbortController().signal;
  const slice = createRouteSlice({ id: 'c1' }, context);
  slice.start(
    /** @type {any} */ ({
      context,
      params: { id: 'c1' },
      dispatch: () => {},
      listen: () => {},
      isActive: () => true,
      signal,
    })
  );
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.equal(readOptions?.signal, signal, 'the Case read carries the signal');
  assert.deepEqual(
    loadedByQueue,
    [readRow],
    'the SaveQueue still receives the loaded Case Row'
  );
});

// --- End-to-end: a Case Type renames every Section ---

/**
 * A Case whose roles and status leave no Section hidden, so one render can
 * check every caption at once: the viewer is the Assigned Reviewer (Details,
 * Review, Issues, Notes), the Journey Owner the Case Type routes appeals to
 * (Appeal), and Controls (Appeal Review, Amend Outcome); the Case is Completed
 * with an open Appeal and one failed Question carrying remediation, which is
 * what opens the Remediation tab.
 */
function everySectionVisibleCase() {
  /** @type {any[]} */
  const catalogue = [
    {
      id: 'q1',
      text: 'Question one',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
  ];
  /** @type {any} */
  const row = {
    ...caseRow,
    status: 'Completed',
    completedAt: '2026-05-04',
    notes: 'Reviewer note',
    answers: {
      q1: {
        value: 'No',
        remediationRequired: 'yes',
        freeFormRemediation: 'Write to the customer',
      },
    },
    appeals: [
      {
        id: 'a1',
        state: 'open',
        rationale: 'Please look again',
        raisedBy: 'u1',
        raisedAt: '2026-05-05',
      },
    ],
  };
  /** @type {any} */
  const config = {
    detailFields: [{ key: 'customerName', label: 'Customer name' }],
    captureGroups: [],
    appeal: { raisedBy: 'journeyOwner' },
    outcomeOptions: [{ id: 'pass', wording: 'Compliant', severity: 0 }],
    computeOutcome: () => ({ outcome: 'pass' }),
  };
  /** @type {any[]} */
  const roles = ['assignedReviewer', 'journeyOwner', 'controls'];
  /** @type {any} */
  const access = {};
  for (const section of SECTIONS) {
    access[section] = evaluateAccess(section, roles, row, config, catalogue);
  }
  return { row, config, catalogue, access };
}

test('a Case Type that renames every Section renames every tab and every heading', () => {
  const { row, config, catalogue, access } = everySectionVisibleCase();

  assert.deepEqual(
    Object.entries(access).filter(([, mode]) => mode === 'hidden'),
    [],
    'the fixture must leave every Section visible, or the render skips its panel'
  );

  const sectionLabels = resolveSectionLabels({
    sectionLabels: {
      details: 'Background',
      questions: { tab: 'Assess', heading: 'Assessment' },
      issues: 'Findings',
      remediation: 'Fix-ups',
      summary: 'Wrap-up',
      notes: 'Scribbles',
      conversation: 'Chat',
      appealRequest: 'Challenge',
      appealReview: 'Challenge Review',
      amendOutcome: 'Correct Outcome',
    },
  });

  const state = caseReviewReducer(createInitialCaseReviewState(chrome), {
    type: 'case/load-finished',
    snapshot: /** @type {any} */ ({
      ...snapshot(),
      caseRow: row,
      config,
      catalogue,
      applicableQuestions: catalogue,
      answers: row.answers,
      allAnswered: true,
      summarySections: ['details', 'questions', 'issues', 'notes'],
      access,
      sectionLabels,
    }),
  });
  const { container } = renderShippedState(state);

  const tabNames = queryAllByRole(container, 'tab').map(
    (tab) => tab.textContent
  );
  assert.deepEqual(tabNames, [
    'Background',
    'Assess',
    'Findings',
    'Fix-ups',
    'Wrap-up',
    'Scribbles',
    'Challenge',
    'Challenge Review',
    'Correct Outcome',
  ]);

  const headings = queryAllByTag(container, 'h2').map(
    (node) => node.textContent
  );
  for (const expected of [
    'Background',
    'Assessment',
    'Findings',
    'Fix-ups',
    'Wrap-up',
    'Scribbles',
    'Challenge',
    'Challenge Review',
    'Correct Outcome',
    'Chat',
  ]) {
    assert.ok(
      headings.includes(expected),
      `expected an h2 reading "${expected}", got ${JSON.stringify(headings)}`
    );
  }

  const blockTitles = queryAllByTag(container, 'h3').map(
    (node) => node.textContent
  );
  for (const expected of [
    'Background',
    'Assessment',
    'Findings',
    'Scribbles',
  ]) {
    assert.ok(
      blockTitles.includes(expected),
      `expected a Summary block titled "${expected}", got ${JSON.stringify(blockTitles)}`
    );
  }
});
