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
} from './helpers/semantic-dom.js';

installDom();

const { caseReviewReducer, createRouteSlice, createInitialCaseReviewState } =
  await import('../src/pages/cora-case-review.js');
const { caseDetailsView } =
  await import('../src/pages/cora-case-review/details-view.js');
const { createCaseReviewSaveEffect, observeSaveStatus } =
  await import('../src/pages/cora-case-review/case-actions.js');
const { SaveQueue } = await import('../src/services/save-queue.js');
const { morph } = await import('../src/core/morph.js');

/** @type {import('../src/core/chrome-state.js').ChromeState} */
const chrome = {
  toasts: [],
  nav: { currentHash: '#/case/example-review/c1' },
  currentUser: { id: 'u1', displayName: 'User 1' },
  permissions: {
    isReviewer: true,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
  },
};

/** @type {import('../src/sharepoint-client.js').CaseRow} */
const caseRow = {
  id: 'c1',
  caseType: 'example-review',
  title: 'Config-driven Case',
  status: 'In-progress',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'e1',
  details: { customerName: 'Ada Lovelace', accountNumber: '' },
};

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
    },
    catalogue,
    applicableQuestions: catalogue,
    answers: caseRow.answers,
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
    sectionLabels: {
      details: 'Details',
      questions: 'Review',
      issues: 'Issues',
      remediation: 'Remediation',
      summary: 'Summary',
      notes: 'Notes',
      conversation: 'Conversation',
      appealRequest: 'Appeal',
      appealReview: 'Appeal Review',
      amendOutcome: 'Amend Outcome',
    },
    sectionHeadings: {
      details: 'Case Details',
      questions: 'Questions',
      issues: 'Issues',
      remediation: 'Remediation',
      summary: 'Summary',
      notes: 'Notes',
      conversation: 'Conversation',
      appealRequest: 'Appeal',
      appealReview: 'Appeal Review',
      amendOutcome: 'Amend Outcome',
    },
  });
}

/**
 * Render through the same route-slice path production mounts. `start()` is
 * intentionally not called: these view tests provide store state directly.
 *
 * @param {any} initialState
 */
function renderShippedState(initialState) {
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    /** @type {any} */ ({
      client: {},
      saveQueue: {},
      currentUser: chrome.currentUser,
      capabilities: chrome.permissions,
      chrome,
    })
  );
  let state = initialState;
  /** @type {any[]} */
  const actions = [];
  const container = document.createElement('main');
  /** @type {any} */
  let tools;
  tools = {
    morph,
    dispatch(/** @type {any} */ action) {
      actions.push(action);
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
  };
  slice.render(container, state, tools);
  return {
    actions,
    container,
    get state() {
      return state;
    },
  };
}

test('CASE-1 state: route state owns loading, save status, and selected tab under routes.caseReview', () => {
  const initial = createInitialCaseReviewState(chrome, 'popover');
  assert.equal(initial.chrome, chrome);
  assert.deepEqual(initial.routes.caseReview, {
    activeTab: '',
    activeQuestionGroup: '',
    panelMode: 'popover',
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
});

test('CASE-1 state: tab selection is store-owned and rejects hidden Sections', () => {
  let state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: snapshot() }
  );
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

test('CASE-1 state: model refreshes and Answer edits preserve valid selection and fall back when access changes', () => {
  const initial = createInitialCaseReviewState(chrome, 'popover');
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

test('CASE-1 Details view mirrors today: config-driven values are read-only with empty fallback', () => {
  const view = caseDetailsView(caseRow, snapshot().config.detailFields);
  assert.equal(getByTag(view, 'h2').textContent, 'Case Details');
  assert.match(view.textContent, /Customer nameAda Lovelace/);
  assert.match(view.textContent, /Account number—/);
  assert.equal(queryAllByRole(view, 'textbox').length, 0);
  assert.equal(view.getAttribute('data-access'), 'read-only');
});

test('CASE-1 view: shipped tab shell renders only permitted tabs and dispatches selection', async () => {
  const state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: snapshot() }
  );
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

test('CASE-1 view: conflict state is surfaced with the existing reload warning', () => {
  let state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: snapshot() }
  );
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
  const root = /** @type {HTMLElement} */ (view.childNodes[0]);
  const status = /** @type {HTMLElement} */ (root.childNodes[0]);
  assert.deepEqual(
    {
      position: status.style.position,
      bottom: status.style.bottom,
      right: status.style.right,
      zIndex: status.style.zIndex,
    },
    {
      position: 'fixed',
      bottom: 'var(--cora-space-4)',
      right: 'var(--cora-space-4)',
      zIndex: '110',
    }
  );
});

test('CASE-1 view: loading, error, denied, saving, and reconnecting states are explicit', () => {
  const initial = createInitialCaseReviewState(chrome, 'popover');
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

test('CASE-1 save effect: rapid Answer dispatches coalesce through unchanged SaveQueue', async () => {
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
    caseId: 'c1',
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

test('CASE-1 save effect: conflict status re-enters route state through dispatch', async () => {
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

test('CASE-1 route: mock-mode store shell keeps interim Review working at the existing URL', async () => {
  let storedRow = { ...caseRow, caseType: 'example-review' };
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
    morph,
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
  };
  slice.render(container, state, tools);
  const dispose = slice.start?.(tools);
  await waitFor(
    () => state.routes.caseReview.snapshot?.loaded === true,
    'store-driven Case Review load'
  );

  assert.equal(state.routes.caseReview.snapshot?.loaded, true);
  assert.equal(queryAllByRole(container, 'tab').length, 7);
  assert.match(container.textContent, /Ada Lovelace/);
  fireEvent(getByRole(container, 'tab', { name: 'Notes' }), 'click');
  assert.equal(state.routes.caseReview.activeTab, 'notes');
  assert.equal(location.hash, '#/case/example-review/c1');

  const reviewPanel = queryAllByRole(container, 'tabpanel').find(
    (panel) => panel.getAttribute('id') === 'case-panel-questions'
  );
  assert.ok(reviewPanel, 'store-driven Review panel remains mounted');
  const yes = reviewPanel.querySelector(
    '[data-focus-key="answer:q-welcome:0"]'
  );
  assert.ok(yes);
  fireEvent(yes, 'change');
  await saveQueue.whenIdle();
  await flush();

  assert.deepEqual(patches, [{ answers: { 'q-welcome': { value: 'Yes' } } }]);
  assert.equal(state.routes.caseReview.saveStatus, 'saved');

  if (typeof dispose === 'function') dispose();
  location.search = previousSearch;
  location.hash = previousHash;
});
