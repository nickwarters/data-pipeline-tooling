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

installDom();

const { caseReviewReducer, createRouteSlice, createInitialCaseReviewState } =
  await import('../src/pages/cora-case-review.js');
const { caseDetailsView } =
  await import('../src/pages/cora-case-review/details-view.js');
const { createCaseReviewSaveEffect, observeSaveStatus } =
  await import('../src/pages/cora-case-review/case-actions.js');
const { SaveQueue } = await import('../src/services/save-queue.js');
const { morph } = await import('../src/core/morph.js');
const { default: exampleReviewConfig } =
  await import('./_example-review-case-type.js');
const { default: complaintsConfig } =
  await import('../case-types/complaints.js');
const { evaluateAccess } = await import('../src/services/section-access.js');

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
 * @param {Record<string, any>} [contextOverrides]
 */
function renderShippedState(initialState, contextOverrides = {}) {
  const slice = createRouteSlice(
    { caseType: 'example-review', id: 'c1' },
    /** @type {any} */ ({
      client: {},
      saveQueue: {},
      currentUser: chrome.currentUser,
      capabilities: chrome.permissions,
      chrome,
      ...contextOverrides,
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

/**
 * Mount the shipped Issues panel with one attributable failed Answer while the
 * Case load remains pending, so attribution-search behavior is exercised only
 * through the route's public render/start seams.
 * @param {(query: string) => Promise<any[]>} searchPeople
 */
function renderAttributionSearchRoute(searchPeople) {
  const failedSnapshot = snapshot();
  failedSnapshot.catalogue[0].failureValues = ['No'];
  failedSnapshot.answers = { q1: { value: 'No' } };
  failedSnapshot.caseRow = {
    ...failedSnapshot.caseRow,
    answers: failedSnapshot.answers,
  };
  failedSnapshot.config.attributeFailures = true;
  failedSnapshot.machine = {
    canAttribute: true,
    canCapture: false,
    canSelectRemediation: false,
    canToggleConversation: false,
  };
  let state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: failedSnapshot }
  );
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'issues',
  });
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
  /** @type {any} */
  let tools;
  tools = {
    morph,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    listen() {},
  };
  slice.render(container, state, tools);
  const dispose = slice.start(tools);
  return {
    container,
    dispose,
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
    conversationHidden: true,
    completionPending: false,
    captureCollapsed: {},
    attributionSearch: {},
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

test('CASE-5 state: attribution search query and results stay independent per failed Question', () => {
  let state = createInitialCaseReviewState(chrome, 'popover');
  state = caseReviewReducer(state, {
    type: 'case/attribution-search-input',
    questionId: 'q1',
    query: 'Jane',
  });
  state = caseReviewReducer(state, {
    type: 'case/attribution-search-input',
    questionId: 'q2',
    query: 'Alex',
  });
  state = caseReviewReducer(state, {
    type: 'case/attribution-search-results',
    questionId: 'q1',
    query: 'Jane',
    people: [{ loginName: 'jsmith', displayName: 'Jane Smith' }],
  });

  assert.deepEqual(state.routes.caseReview.attributionSearch, {
    q1: {
      query: 'Jane',
      people: [{ loginName: 'jsmith', displayName: 'Jane Smith' }],
    },
    q2: { query: 'Alex', people: [] },
  });
  assert.equal(
    caseReviewReducer(state, {
      type: 'case/attribution-search-results',
      questionId: 'missing',
      query: 'Nobody',
      people: [],
    }),
    state
  );
  const cleared = caseReviewReducer(state, {
    type: 'case/attribution-search-cleared',
    questionId: 'q1',
  });
  assert.deepEqual(cleared.routes.caseReview.attributionSearch, {
    q2: { query: 'Alex', people: [] },
  });
  assert.equal(
    caseReviewReducer(state, {
      type: 'case/attribution-search-results',
      questionId: 'q2',
      query: 'Stale',
      people: [],
    }),
    state
  );
  assert.equal(
    caseReviewReducer(state, {
      type: 'case/attribution-search-cleared',
      questionId: 'missing',
    }),
    state
  );
});

test('CASE-5 route: attribution search is debounced and renders route-owned results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {string[]} */
  const searches = [];
  const route = renderAttributionSearchRoute(async (query) => {
    searches.push(query);
    return [{ loginName: 'jsmith', displayName: 'Jane Smith' }];
  });
  const input = getByRole(route.container, 'combobox', {
    name: 'Search people',
  });
  input.value = 'Ja';
  fireEvent(input, 'input');
  const updatedInput = getByRole(route.container, 'combobox', {
    name: 'Search people',
  });
  updatedInput.value = 'Jane';
  fireEvent(updatedInput, 'input');

  assert.equal(
    route.state.routes.caseReview.attributionSearch.q1.query,
    'Jane'
  );
  t.mock.timers.tick(199);
  assert.deepEqual(searches, []);
  t.mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(searches, ['Jane']);
  assert.equal(
    getByRole(route.container, 'option', { name: /Jane Smith/ }).textContent,
    'Jane Smith — jsmith'
  );
  const clearedInput = getByRole(route.container, 'combobox', {
    name: 'Search people',
  });
  clearedInput.value = '   ';
  fireEvent(clearedInput, 'input');
  t.mock.timers.tick(200);
  assert.deepEqual(searches, ['Jane']);
  route.dispose();
});

test('CASE-5 route: a stale attribution result cannot replace the latest query', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {Record<string, (people: any[]) => void>} */
  const resolveSearch = {};
  const route = renderAttributionSearchRoute(
    (query) =>
      new Promise((resolve) => {
        resolveSearch[query] = resolve;
      })
  );
  let input = getByRole(route.container, 'combobox', {
    name: 'Search people',
  });
  input.value = 'Jane';
  fireEvent(input, 'input');
  t.mock.timers.tick(200);

  input = getByRole(route.container, 'combobox', { name: 'Search people' });
  input.value = 'Janet';
  fireEvent(input, 'input');
  t.mock.timers.tick(200);
  resolveSearch.Janet([{ loginName: 'jdoe', displayName: 'Janet Doe' }]);
  await Promise.resolve();
  await Promise.resolve();
  resolveSearch.Jane([{ loginName: 'jsmith', displayName: 'Jane Smith' }]);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(
    route.state.routes.caseReview.attributionSearch.q1.query,
    'Janet'
  );
  assert.equal(
    getByRole(route.container, 'option', { name: /Janet Doe/ }).textContent,
    'Janet Doe — jdoe'
  );
  assert.equal(route.container.textContent.includes('Jane Smith'), false);
  route.dispose();
});

test('CASE-5 route: disposal clears attribution debounce and suppresses an in-flight result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {string[]} */
  const searches = [];
  const waiting = renderAttributionSearchRoute(async (query) => {
    searches.push(query);
    return [];
  });
  let input = getByRole(waiting.container, 'combobox', {
    name: 'Search people',
  });
  input.value = 'Never sent';
  fireEvent(input, 'input');
  waiting.dispose();
  t.mock.timers.tick(200);
  assert.deepEqual(searches, []);

  /** @type {(people: any[]) => void} */
  let resolveSearch = () => {};
  const inFlight = renderAttributionSearchRoute(
    () =>
      new Promise((resolve) => {
        resolveSearch = resolve;
      })
  );
  input = getByRole(inFlight.container, 'combobox', {
    name: 'Search people',
  });
  input.value = 'Late';
  fireEvent(input, 'input');
  t.mock.timers.tick(200);
  inFlight.dispose();
  resolveSearch([{ loginName: 'late', displayName: 'Late Result' }]);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(
    inFlight.state.routes.caseReview.attributionSearch.q1.people,
    []
  );
});

test('CASE-5 route: selecting the Responsible Party cancels that Question search', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {string[]} */
  const searches = [];
  const route = renderAttributionSearchRoute(async (query) => {
    searches.push(query);
    return [];
  });
  const input = getByRole(route.container, 'combobox', {
    name: 'Search people',
  });
  input.value = 'Pending';
  fireEvent(input, 'input');
  fireEvent(
    getByRole(route.container, 'button', {
      name: 'Responsible Party — u2',
    }),
    'click'
  );
  t.mock.timers.tick(200);

  assert.deepEqual(searches, []);
  assert.equal(route.state.routes.caseReview.attributionSearch.q1, undefined);
  route.dispose();
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

test('CASE-1 route: the conversation host is a direct child the scoped popover CSS can target', () => {
  const state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: snapshot() }
  );
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

test('CASE-6 route: Appeal renders directly from store state without legacy controller wiring', () => {
  const appealSnapshot = snapshot();
  appealSnapshot.access = {
    ...appealSnapshot.access,
    appealRequest: 'edit',
  };
  let state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: appealSnapshot }
  );
  state = caseReviewReducer(state, {
    type: 'case/tab-selected',
    id: 'appealRequest',
  });

  const { container } = renderShippedState(state);
  const panel = queryAllByRole(container, 'tabpanel').find(
    (candidate) => candidate.getAttribute('id') === 'case-panel-appealRequest'
  );
  assert.ok(panel);
  assert.equal(queryAllByTag(panel, 'cora-appeal').length, 1);
  assert.equal(
    getByRole(panel, 'button', { name: 'Raise Appeal' }).textContent,
    'Raise Appeal'
  );
});

test('CASE-6 route: configured Journey Owner and alternative Manager raisers reach the converted Appeal surface', () => {
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
          resolvedBy: /** @type {const} */ ('controls'),
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
    let state = caseReviewReducer(
      createInitialCaseReviewState(chrome, 'popover'),
      { type: 'case/load-finished', snapshot: appealSnapshot }
    );
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

test('CASE-6 route: raising an Appeal persists through the store-owned panel', () => {
  const appealSnapshot = snapshot();
  appealSnapshot.access = {
    ...appealSnapshot.access,
    appealRequest: 'edit',
  };
  let state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: appealSnapshot }
  );
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

test('CASE-6 route: Appeal action remains live after switching from another tab', () => {
  const appealSnapshot = snapshot();
  appealSnapshot.caseRow = { ...appealSnapshot.caseRow, appeals: [] };
  appealSnapshot.access = {
    ...appealSnapshot.access,
    appealRequest: 'edit',
  };
  const state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: appealSnapshot }
  );
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

test('CASE-6 route: Controls resolves an Appeal and amends an Outcome through state-derived edit access', () => {
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

  let reviewState = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: controlsSnapshot }
  );
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
  let amendState = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: controlsSnapshot }
  );
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

test('CASE-6 route: Appeal Review action remains live after switching from another tab', () => {
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
  const state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: controlsSnapshot }
  );
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

test('CASE-6 route: Amend Outcome action remains live after switching from another tab', () => {
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
  const state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: controlsSnapshot }
  );
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

test('CASE-6 route: appeal views keep empty Case Type configuration defaults', () => {
  const minimal = snapshot();
  minimal.caseRow = { ...minimal.caseRow, responsibleParty: '' };
  delete minimal.config.detailFields;
  delete minimal.config.captureGroups;
  delete minimal.config.remediationFields;
  delete minimal.config.placeholders;
  delete minimal.config.outcomeOptions;
  minimal.access = {
    ...minimal.access,
    appealRequest: 'hidden',
    appealReview: 'read-only',
    amendOutcome: 'read-only',
  };
  const state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: minimal }
  );
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

test('case page reducer keeps group, conversation, and field state behind loaded access', () => {
  const initial = createInitialCaseReviewState(chrome, 'popover');
  assert.equal(
    caseReviewReducer(initial, {
      type: 'case/question-group-selected',
      group: 'General',
    }),
    initial
  );
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
  assert.equal(state.routes.caseReview.activeQuestionGroup, 'General');
  assert.equal(
    caseReviewReducer(state, {
      type: 'case/question-group-selected',
      group: 'Missing',
    }),
    state
  );
  assert.equal(
    caseReviewReducer(state, {
      type: 'case/question-group-selected',
      group: 'General',
    }),
    state
  );
  state = caseReviewReducer(state, {
    type: 'case/question-group-selected',
    group: 'Follow-up',
  });
  assert.equal(state.routes.caseReview.activeQuestionGroup, 'Follow-up');

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

test('CASE-4 view: Summary is rendered from store state and configured sections', () => {
  let state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: snapshot() }
  );
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
});

test('CASE-4 view: Summary applies empty config defaults and incomplete snapshots stay inert', () => {
  const baseSnapshot = snapshot();
  const minimalSummarySnapshot = {
    ...baseSnapshot,
    config: {
      computeOutcome: baseSnapshot.config.computeOutcome,
    },
  };
  let state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: minimalSummarySnapshot }
  );
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
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: incomplete }
  );
  assert.doesNotThrow(() => renderShippedState(incompleteState));
});

test('CASE-5 view: Issues renders failed Answers directly from route state', () => {
  const answers = {
    q1: {
      value: 'No',
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
  let state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: loadedSnapshot }
  );
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

test('CASE-4 action: completion flushes saves and persists only the CaseMachine transition', async () => {
  const transitionPatch = {
    status: 'Completed',
    completedAt: '2026-07-19T12:00:00Z',
    outcomeAtCompletion: 'pass',
    questionBankVersion: 'bank-hash',
  };
  const machine = /** @type {any} */ ({
    canComplete: true,
    canCompleteRemediation: false,
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
  const state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: loadedSnapshot }
  );
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

test('CASE-4 action: a missing CaseMachine transition cannot dispatch completion', async () => {
  const loadedSnapshot = {
    ...snapshot(),
    machine: /** @type {any} */ ({
      canComplete: true,
      canCompleteRemediation: false,
    }),
    allAnswered: true,
  };
  const state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: loadedSnapshot }
  );
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

test('CASE-7 route: Notes and Conversation write through store-owned callbacks', async () => {
  const interactive = snapshot();
  interactive.machine = { canToggleConversation: true };
  let state = caseReviewReducer(
    createInitialCaseReviewState(chrome, 'popover'),
    { type: 'case/load-finished', snapshot: interactive }
  );
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

test('CASE-7 route: mock-mode store shell keeps Review working at the existing URL', async () => {
  const qNeeds = exampleReviewConfig.questions.find(
    (question) => question.id === 'q-needs'
  );
  assert.ok(qNeeds);
  const originalFreeForm = qNeeds.allowFreeFormRemediation;
  qNeeds.allowFreeFormRemediation = true;
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

  assert.deepEqual(patches, [
    {
      answers: {
        'q-needs': { value: 'No' },
        'q-welcome': { value: 'Yes' },
      },
    },
  ]);
  assert.equal(state.routes.caseReview.saveStatus, 'saved');

  fireEvent(getByRole(container, 'tab', { name: 'Issues' }), 'click');
  const issuesPanel = container.querySelector('#case-panel-issues');
  const responsibleParty = issuesPanel?.querySelector(
    '.cora-attribute-responsible'
  );
  assert.ok(responsibleParty, 'Responsible Party quick-pick is rendered');
  tools.dispatch({
    type: 'case/attribution-search-input',
    questionId: 'q-needs',
    query: 'stale picker text',
  });
  assert.equal(
    state.routes.caseReview.attributionSearch['q-needs'].query,
    'stale picker text'
  );
  fireEvent(responsibleParty, 'click');
  await saveQueue.whenIdle();
  await flush();
  assert.equal(state.routes.caseReview.attributionSearch['q-needs'], undefined);

  assert.equal(issuesPanel?.querySelector('cora-capture-groups'), null);
  const capture = /** @type {any} */ (
    issuesPanel?.querySelector('.cora-capture-input')
  );
  assert.ok(capture, 'configured Issue Capture field is rendered directly');
  capture.value = 'Agent rushed';
  fireEvent(capture, 'change');
  await saveQueue.whenIdle();
  await flush();

  const detail = /** @type {any} */ (
    issuesPanel?.querySelector('.cora-remediation-detail-input')
  );
  assert.ok(detail, 'configured Remediation Detail is rendered');
  detail.value = 'Rushed';
  fireEvent(detail, 'change');
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
      completed: false,
    },
  ]);
  assert.deepEqual(savedAnswer.remediationDetails, {
    rootCause: 'Rushed',
  });
  assert.deepEqual(savedAnswer.capture, {
    rootCause: 'Agent rushed',
  });
  assert.deepEqual(savedAnswer.attributedParty, {
    loginName: 'u2',
    displayName: 'u2',
  });
  assert.equal(savedAnswer.freeFormRemediation, 'Coach the agent');

  if (typeof dispose === 'function') dispose();
  qNeeds.allowFreeFormRemediation = originalFreeForm;
  location.search = previousSearch;
  location.hash = previousHash;
});

test('CASE-5 route: remediation tracking resolves a sent action through the store seam', async () => {
  const originalCaptureGroups = exampleReviewConfig.captureGroups;
  exampleReviewConfig.captureGroups = [
    ...(originalCaptureGroups ?? []),
    {
      key: 'actions',
      label: 'Actions',
      collapsed: false,
      fields: [{ key: 'sentActions', label: 'Actions', type: 'actions' }],
    },
  ];
  let storedRow = {
    ...caseRow,
    status: 'Actions In Progress',
    caseType: 'example-review',
    answers: {
      'q-needs': {
        value: 'No',
        capture: {
          sentActions: [
            { id: 'sent-1', text: 'Coach the agent', status: 'pending' },
          ],
        },
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
    assert.ok(status, 'sent action status control is rendered');
    status.value = 'complete';
    fireEvent(status, 'change');
    await saveQueue.whenIdle();
    await flush();

    assert.equal(
      patches.at(-1)?.answers?.['q-needs']?.capture?.sentActions?.[0]?.status,
      'complete',
      JSON.stringify(patches)
    );
  } finally {
    if (typeof dispose === 'function') dispose();
    exampleReviewConfig.captureGroups = originalCaptureGroups;
    location.search = previousSearch;
    location.hash = previousHash;
  }
});
