// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

installDom();

const { conversationPageView, createRouteSlice } =
  await import('../src/pages/cora-conversation-view.js');
const { morph } = await import('../src/core/morph.js');
const { conversationView, postConversationMessage, refreshConversation } =
  await import('../src/pages/cora-case-review/conversation-view.js');

const CURRENT_USER = { id: 'reviewer', displayName: 'Alex Reviewer' };
/** @type {import('../src/sharepoint-client.js').CaseRow} */
const CASE_ROW = {
  id: 'case-1',
  caseType: 'example-review',
  title: 'Example Review #1',
  status: 'In-progress',
  assignedReviewer: 'reviewer',
  responsibleParty: 'agent',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'v1',
};

test('CASE-3 conversation view renders messages and gates composition by access', () => {
  /** @type {string[]} */
  const sent = [];
  const message = {
    author: 'Taylor',
    timestamp: '2026-07-19T08:00:00.000Z',
    body: 'Please review this evidence.',
  };
  const editable = conversationView({
    messages: [message],
    access: 'edit',
    heading: 'Conversation',
    onSend: (body) => {
      sent.push(body);
    },
  });
  const textarea = editable.querySelector('textarea');
  assert.ok(textarea);
  textarea.value = '  New message  ';
  fireEvent(editable.querySelector('button'), 'click');

  assert.match(editable.textContent, /Taylor/);
  assert.match(editable.textContent, /Please review this evidence/);
  assert.deepEqual(sent, ['New message']);

  const readOnly = conversationView({
    messages: [],
    access: 'read-only',
    heading: 'Conversation',
    onSend() {},
  });
  assert.match(readOnly.textContent, /No messages yet/);
  assert.equal(readOnly.querySelector('textarea'), null);
});

test('CASE-3 posting preserves JSON-blob PATCH, ETag, list routing, and queue refresh', async () => {
  /** @type {any[]} */
  const calls = [];
  const saved = { ...CASE_ROW, etag: 'v2' };
  const saveQueue = {
    getEtag(/** @type {string} */ id) {
      assert.equal(id, 'case-1');
      return 'v1';
    },
    loadCase(/** @type {any} */ row, /** @type {any} */ options) {
      calls.push(['loadCase', row, options]);
    },
  };
  const client = {
    async patchCase(
      /** @type {string} */ id,
      /** @type {any} */ fields,
      /** @type {string} */ etag,
      /** @type {any} */ options
    ) {
      calls.push(['patchCase', id, fields, etag, options]);
      return { ok: true, data: saved };
    },
  };
  /** @type {import('../src/sharepoint-client.js').Message[]} */
  let optimistic = [];

  const result = await postConversationMessage({
    client: /** @type {any} */ (client),
    saveQueue: /** @type {any} */ (saveQueue),
    caseId: 'case-1',
    messages: [],
    currentUser: CURRENT_USER,
    caseListOptions: { listName: 'Example Cases' },
    body: 'New message',
    onMessages: (messages) => {
      optimistic = messages;
    },
  });

  assert.equal(result.messages[0].author, 'Alex Reviewer');
  assert.equal(optimistic[0].body, 'New message');
  assert.equal(calls[0][0], 'patchCase');
  assert.equal(calls[0][1], 'case-1');
  assert.deepEqual(calls[0][2], { conversation: result.messages });
  assert.equal(calls[0][3], 'v1');
  assert.deepEqual(calls[0][4], { listName: 'Example Cases' });
  assert.deepEqual(calls[1], [
    'loadCase',
    saved,
    { listName: 'Example Cases' },
  ]);
});

test('CASE-7 posting leaves queue state untouched when the PATCH is rejected', async () => {
  let loads = 0;
  const result = await postConversationMessage({
    client: /** @type {any} */ ({
      async patchCase() {
        return { ok: false, status: 412 };
      },
    }),
    saveQueue: /** @type {any} */ ({
      getEtag() {
        return 'v1';
      },
      loadCase() {
        loads += 1;
      },
    }),
    caseId: 'case-1',
    messages: [],
    currentUser: CURRENT_USER,
    caseListOptions: {},
    body: 'Retry later',
  });

  assert.equal(result.result.status, 412);
  assert.equal(loads, 0);
});

test('CASE-3 standalone page and reducer render store state without a custom element', () => {
  const state = {
    chrome: /** @type {any} */ ({}),
    routes: {
      conversation: {
        caseRow: CASE_ROW,
        access: /** @type {const} */ ('edit'),
        caseListOptions: {},
        error: null,
      },
    },
  };
  const node = conversationPageView(state, { dispatch() {} }, () => {});
  assert.match(node.textContent, /Example Review #1/);
  assert.equal(node.querySelector('cora-conversation'), null);

  const slice = createRouteSlice(
    { id: 'case-1', caseType: 'example-review' },
    /** @type {any} */ ({
      chrome: {
        currentUser: CURRENT_USER,
        permissions: {},
      },
      currentUser: CURRENT_USER,
      client: {},
      saveQueue: {},
    })
  );
  const loaded = slice.reducer(slice.initialState, {
    type: 'conversation/loaded',
    caseRow: CASE_ROW,
    access: 'read-only',
    caseListOptions: { listName: 'Example Cases' },
  });
  const changed = slice.reducer(loaded, {
    type: 'conversation/messages-changed',
    messages: [{ author: 'A', timestamp: '2026-07-19', body: 'B' }],
  });
  assert.equal(changed.routes.conversation.caseRow?.conversation[0].body, 'B');
  assert.strictEqual(
    slice.reducer(changed, { type: 'unrelated' }),
    changed,
    'unknown actions preserve state identity'
  );
  assert.strictEqual(changed.chrome, slice.initialState.chrome);
  assert.strictEqual(
    changed.routes.conversation.caseListOptions,
    loaded.routes.conversation.caseListOptions
  );
});

test('CASE-3 refresh fetches the routed case', async () => {
  /** @type {any[]} */
  const calls = [];
  const row = await refreshConversation({
    client: /** @type {any} */ ({
      async getCase(/** @type {string} */ id, /** @type {any} */ options) {
        calls.push([id, options]);
        return CASE_ROW;
      },
    }),
    caseId: 'case-1',
    caseListOptions: { listName: 'Example Cases' },
  });
  assert.equal(row, CASE_ROW);
  assert.deepEqual(calls, [['case-1', { listName: 'Example Cases' }]]);
});

test('#544 conversation page: Send posts the typed Message through the route’s own effect', async () => {
  /** @type {any[]} */
  const patches = [];
  const saveQueue = {
    getEtag: () => 'v1',
    loadCase: () => {},
  };
  const client = {
    async patchCase(
      /** @type {string} */ id,
      /** @type {any} */ fields,
      /** @type {string} */ etag,
      /** @type {any} */ options
    ) {
      patches.push([id, fields, etag, options]);
      return { ok: true, data: { ...CASE_ROW, etag: 'v2' } };
    },
  };
  const slice = createRouteSlice(
    { id: 'case-1', caseType: 'example-review' },
    /** @type {any} */ ({
      chrome: { currentUser: CURRENT_USER, permissions: {} },
      currentUser: CURRENT_USER,
      client,
      saveQueue,
    })
  );
  let state = slice.reducer(slice.initialState, {
    type: 'conversation/loaded',
    caseRow: CASE_ROW,
    access: 'edit',
    caseListOptions: { listName: 'Example Cases' },
  });
  const container = document.createElement('main');
  /** @type {any} */
  let tools;
  tools = {
    morph,
    dispatch(/** @type {any} */ action) {
      state = slice.reducer(state, action);
      slice.render(container, state, tools);
    },
    isActive: () => true,
  };
  slice.render(container, state, tools);

  const textarea = container.querySelector('textarea');
  assert.ok(textarea, 'the composer is rendered for an edit-access viewer');
  textarea.value = 'Chasing the remediation';
  const send = [...container.querySelectorAll('button')].find(
    (/** @type {any} */ button) =>
      button.getAttribute('aria-label') === 'Send message'
  );
  fireEvent(send, 'click');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(patches.length, 1, 'the page wired Send to its posting effect');
  assert.equal(patches[0][0], 'case-1');
  assert.equal(
    patches[0][1].conversation.at(-1).body,
    'Chasing the remediation'
  );
  assert.deepEqual(patches[0][3], { listName: 'Example Cases' });
  // …and the optimistic messages reached the store, so the thread re-renders.
  assert.equal(
    state.routes.conversation.caseRow?.conversation.at(-1)?.body,
    'Chasing the remediation'
  );
});

test('#544 conversation page: the back button returns to My Reviews', () => {
  // Derive the state through the reducer rather than hand-writing the route
  // slice: a literal drifts silently when the slice shape changes (#544).
  const slice = createRouteSlice(
    { id: 'case-1', caseType: 'example-review' },
    /** @type {any} */ ({
      chrome: { currentUser: CURRENT_USER, permissions: {} },
      currentUser: CURRENT_USER,
    })
  );
  const state = slice.reducer(slice.initialState, {
    type: 'conversation/loaded',
    caseRow: CASE_ROW,
    access: 'read-only',
    caseListOptions: {},
  });
  const node = conversationPageView(
    /** @type {any} */ (state),
    /** @type {any} */ ({ dispatch() {} }),
    () => {}
  );
  /** @type {any} */ (globalThis).location = { hash: '#/conversation/x/y' };
  fireEvent(node.querySelector('.cora-back-btn'), 'click');
  assert.equal(location.hash, '#/my-reviews');
});

test('conversation slice: navigating away aborts the in-flight Case read with no error UI (#567)', async () => {
  const controller = new AbortController();
  let aborted = false;
  /** @type {any[]} */
  const actions = [];
  const context = /** @type {any} */ ({
    chrome: { currentUser: CURRENT_USER, permissions: {} },
    currentUser: CURRENT_USER,
    client: {
      getCase: (/** @type {any} */ _id, /** @type {any} */ opts = {}) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(opts.signal.reason);
          });
        }),
    },
    saveQueue: {},
  });
  const slice = createRouteSlice({ id: 'case-1' }, context);

  slice.start(
    /** @type {any} */ ({
      context,
      params: { id: 'case-1' },
      dispatch: (/** @type {any} */ action) => actions.push(action),
      listen: () => {},
      isActive: () => !controller.signal.aborted,
      signal: controller.signal,
    })
  );
  controller.abort();

  // An unhandled AbortError rejection fails the run under `node --test`.
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.equal(aborted, true, 'the in-flight Case read was cancelled');
  assert.deepEqual(actions, [], 'the aborted load dispatches nothing at all');
});
