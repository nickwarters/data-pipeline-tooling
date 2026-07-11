// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass } from './_dom-stub.js';

installDom();

const docListeners = /** @type {any} */ (globalThis).document._listeners;

// ===== IMPORTS (after stubs) =====
const { CORAConversation } =
  await import('../src/components/sections/cora-conversation.js');

/** @typedef {import('../src/sharepoint-client.js').Message} Message */
/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').CurrentUser} CurrentUser */

// ===== FIXTURES =====

/** @type {Message[]} */
const TWO_MESSAGES = [
  {
    author: 'Alex Reviewer',
    timestamp: '2026-05-07T09:00:00Z',
    body: 'Please confirm the greeting.',
  },
  {
    author: 'Bob Agent',
    timestamp: '2026-05-07T09:15:00Z',
    body: 'Standard greeting was used.',
  },
];

/** @type {CurrentUser} */
const CURRENT_USER = { id: 'user-reviewer', displayName: 'Alex Reviewer' };

/** @type {CaseRow} */
const BASE_CASE = {
  id: 'case-2',
  caseType: 'example-review',
  title: 'Example Review #2',
  status: 'In-progress',
  assignedReviewer: 'user-reviewer',
  responsibleParty: 'user-agent-b',
  answers: {},
  conversation: TWO_MESSAGES.slice(),
  notes: '',
  completedAt: null,
  etag: 'etag-c2-v1',
};

// ===== HELPERS =====

/**
 * @param {string} [etag]
 */
function makeStubSaveQueue(etag = 'etag-c2-v1') {
  /** @type {CaseRow[]} */
  const loadedCases = [];
  return {
    loadedCases,
    getEtag(/** @type {string} */ _id) {
      return etag;
    },
    loadCase(/** @type {CaseRow} */ row) {
      loadedCases.push(row);
    },
  };
}

/**
 * @param {{ conversation?: Message[], etag?: string }} [opts]
 */
function makeStubClient({
  conversation = TWO_MESSAGES.slice(),
  etag = 'etag-new',
} = {}) {
  /** @type {{ id: string, fields: any, etag: string }[]} */
  const patchCalls = [];
  return {
    patchCalls,
    async getCase(/** @type {string} */ _id) {
      return /** @type {CaseRow} */ ({ ...BASE_CASE, conversation, etag });
    },
    async patchCase(
      /** @type {string} */ id,
      /** @type {any} */ fields,
      /** @type {string} */ e
    ) {
      patchCalls.push({ id, fields, etag: e });
      return { ok: true, status: 200, data: { ...BASE_CASE, ...fields, etag } };
    },
  };
}

// ===== TESTS =====

test('CORAConversation: empty conversation renders "No messages yet" empty state', () => {
  const el = new CORAConversation();
  el._messages = [];
  el.connectedCallback();

  const empty = findByClass(el, 'cora-empty cora-conversation-empty');
  assert.ok(empty, 'empty state element should exist');
  assert.equal(empty.textContent, 'No messages yet.');
});

test('CORAConversation: non-empty conversation does not render empty state', () => {
  const el = new CORAConversation();
  el._messages = TWO_MESSAGES.slice();
  el.connectedCallback();

  assert.equal(findByClass(el, 'cora-empty cora-conversation-empty'), null);
});

test('CORAConversation: renders one li per message', () => {
  const el = new CORAConversation();
  el._messages = TWO_MESSAGES.slice();
  el.connectedCallback();

  const items = findAllByClass(el, 'cora-conversation-message');
  assert.equal(items.length, 2);
});

test('CORAConversation: each message shows author, timestamp, and body', () => {
  const el = new CORAConversation();
  el._messages = [TWO_MESSAGES[0]];
  el.connectedCallback();

  const item = findByClass(el, 'cora-conversation-message');
  const author = findByClass(item, 'cora-message-author');
  const ts = findByClass(item, 'cora-message-timestamp');
  const body = findByClass(item, 'cora-message-body');

  assert.equal(author.textContent, 'Alex Reviewer');
  assert.ok(ts.textContent.length > 0, 'timestamp should be non-empty');
  assert.equal(body.textContent, 'Please confirm the greeting.');
});

test('CORAConversation: compose area has textarea and send button', () => {
  const el = new CORAConversation();
  el._messages = [];
  el.connectedCallback();

  const compose = findByClass(el, 'cora-conversation-compose');
  assert.ok(compose, 'compose area should exist');
  const textarea = findByClass(compose, 'cora-conversation-input');
  const btn = findByClass(compose, 'cora-conversation-send');
  assert.ok(textarea, 'textarea should exist');
  assert.ok(btn, 'send button should exist');
  assert.equal(btn.textContent, 'Send');
});

test('CORAConversation: send appends new message and patches only conversation field', async () => {
  const client = makeStubClient({ conversation: [] });
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-2';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());
  el.connectedCallback();

  const compose = findByClass(el, 'cora-conversation-compose');
  const textarea = findByClass(compose, 'cora-conversation-input');
  const btn = findByClass(compose, 'cora-conversation-send');
  textarea.value = 'Hello!';
  await btn._listeners['click'][0]();

  const items = findAllByClass(el, 'cora-conversation-message');
  assert.equal(items.length, 1);
  const body = findByClass(items[0], 'cora-message-body');
  assert.equal(body.textContent, 'Hello!');

  assert.equal(client.patchCalls.length, 1);
  assert.equal(client.patchCalls[0].id, 'case-2');
  assert.ok(
    'conversation' in client.patchCalls[0].fields,
    'conversation field should be patched'
  );
  assert.equal(
    Object.keys(client.patchCalls[0].fields).length,
    1,
    'exactly one field patched'
  );
});

test('CORAConversation: send with empty body does not patch', async () => {
  const client = makeStubClient();
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-2';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());
  el.connectedCallback();

  const compose = findByClass(el, 'cora-conversation-compose');
  const btn = findByClass(compose, 'cora-conversation-send');
  // textarea.value is '' by default
  await btn._listeners['click'][0]();

  assert.equal(client.patchCalls.length, 0);
});

test('CORAConversation: after successful send, saveQueue.loadCase is called with updated row', async () => {
  const saveQueue = makeStubSaveQueue();
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-2';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (
    makeStubClient({ conversation: [], etag: 'etag-after-patch' })
  );
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.connectedCallback();

  const compose = findByClass(el, 'cora-conversation-compose');
  const textarea = findByClass(compose, 'cora-conversation-input');
  const btn = findByClass(compose, 'cora-conversation-send');
  textarea.value = 'Test message';
  await btn._listeners['click'][0]();

  assert.equal(
    saveQueue.loadedCases.length,
    1,
    'saveQueue.loadCase should be called once'
  );
  assert.equal(saveQueue.loadedCases[0].etag, 'etag-after-patch');
});

test('CORAConversation: _refresh fetches and updates messages', async () => {
  /** @type {Message[]} */
  const freshMessages = [
    {
      author: 'Bob Agent',
      timestamp: '2026-05-07T10:00:00Z',
      body: 'New reply!',
    },
  ];
  const client = makeStubClient({ conversation: freshMessages });

  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-2';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());
  el.connectedCallback();

  assert.equal(findAllByClass(el, 'cora-conversation-message').length, 0);

  await el._refresh();

  const items = findAllByClass(el, 'cora-conversation-message');
  assert.equal(items.length, 1);
  const body = findByClass(items[0], 'cora-message-body');
  assert.equal(body.textContent, 'New reply!');
});

test('CORAConversation: _refresh does not call patchCase (no clobber of answer edits)', async () => {
  const client = makeStubClient({ conversation: TWO_MESSAGES.slice() });
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-2';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());
  el.connectedCallback();

  await el._refresh();

  assert.equal(client.patchCalls.length, 0, '_refresh must not call patchCase');
});

test('CORAConversation: update() re-renders with new messages', () => {
  const el = new CORAConversation();
  el._messages = [];
  el.connectedCallback();

  assert.ok(findByClass(el, 'cora-empty cora-conversation-empty'));

  el.update(TWO_MESSAGES.slice());
  assert.equal(findByClass(el, 'cora-empty cora-conversation-empty'), null);
  assert.equal(findAllByClass(el, 'cora-conversation-message').length, 2);
});

test('CORAConversation: new message author comes from currentUser.displayName', async () => {
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-2';
  el.currentUser = { id: 'user-123', displayName: 'Test Author' };
  el.client = /** @type {any} */ (makeStubClient({ conversation: [] }));
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());
  el.connectedCallback();

  const compose = findByClass(el, 'cora-conversation-compose');
  const textarea = findByClass(compose, 'cora-conversation-input');
  const btn = findByClass(compose, 'cora-conversation-send');
  textarea.value = 'My message';
  await btn._listeners['click'][0]();

  const item = findByClass(el, 'cora-conversation-message');
  const author = findByClass(item, 'cora-message-author');
  assert.equal(author.textContent, 'Test Author');
});

test('CORAConversation: disconnectedCallback removes the visibilitychange listener', async () => {
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-1';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (makeStubClient({ conversation: [] }));
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());

  const before = (docListeners['visibilitychange'] ?? []).length;
  el.connectedCallback();
  assert.equal(
    (docListeners['visibilitychange'] ?? []).length,
    before + 1,
    'listener should be added on connect'
  );

  el.disconnectedCallback();
  assert.equal(
    (docListeners['visibilitychange'] ?? []).length,
    before,
    'listener should be removed on disconnect'
  );
  assert.equal(
    /** @type {any} */ (el)._visibilityHandler,
    null,
    '_visibilityHandler should be nulled'
  );
});

test('CORAConversation: visibilitychange fires _refresh when document is not hidden', async () => {
  const client = makeStubClient({
    conversation: [
      { author: 'Alex', timestamp: '2026-05-07T09:00:00Z', body: 'Hello' },
    ],
  });
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-1';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());
  el.connectedCallback();

  assert.equal(
    findAllByClass(el, 'cora-conversation-message').length,
    0,
    'no messages before refresh'
  );

  // Simulate tab becoming visible
  /** @type {any} */ (globalThis).document.hidden = false;
  const handlers = docListeners['visibilitychange'] ?? [];
  for (const h of handlers) h();

  // _refresh is async; wait for it
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    findAllByClass(el, 'cora-conversation-message').length,
    1,
    'refresh should load messages'
  );
});

test('CORAConversation: _refresh does nothing when getCase returns null', async () => {
  const client = {
    patchCalls: /** @type {any[]} */ ([]),
    async getCase() {
      return null;
    },
    async patchCase() {
      return { ok: false, status: 404 };
    },
  };
  const el = new CORAConversation();
  el._messages = [TWO_MESSAGES[0]];
  el.caseId = 'case-2';
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());
  el.connectedCallback();

  const before = findAllByClass(el, 'cora-conversation-message').length;
  await el._refresh();
  assert.equal(
    findAllByClass(el, 'cora-conversation-message').length,
    before,
    '_refresh with null case must not change messages'
  );
});

test('CORAConversation: _sendMessage with no result.data does not call saveQueue.loadCase', async () => {
  const client = {
    patchCalls: /** @type {any[]} */ ([]),
    async getCase() {
      return null;
    },
    async patchCase(
      /** @type {string} */ id,
      /** @type {any} */ fields,
      /** @type {string} */ etag
    ) {
      this.patchCalls.push({ id, fields, etag });
      return { ok: true, status: 200 }; // no data field
    },
  };
  const saveQueue = makeStubSaveQueue();
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-2';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.connectedCallback();

  await el._sendMessage('Hello!');
  assert.equal(
    saveQueue.loadedCases.length,
    0,
    'saveQueue.loadCase must not be called when result has no data'
  );
});

test('CORAConversation: visibilitychange does NOT call _refresh when document is hidden', async () => {
  const client = makeStubClient({
    conversation: [
      { author: 'Alex', timestamp: '2026-05-07T09:00:00Z', body: 'Hello' },
    ],
  });
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-1';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());
  el.connectedCallback();

  // Simulate tab still hidden
  /** @type {any} */ (globalThis).document.hidden = true;
  const handlers = docListeners['visibilitychange'] ?? [];
  for (const h of handlers) h();

  await new Promise((resolve) => setImmediate(resolve));
  // Messages should NOT be updated since document is hidden
  assert.equal(
    findAllByClass(el, 'cora-conversation-message').length,
    0,
    '_refresh must not be called when document is still hidden'
  );
  // Reset for other tests
  /** @type {any} */ (globalThis).document.hidden = false;
});

test('CORAConversation: send click with null textarea value treats body as empty (no patch)', async () => {
  const client = makeStubClient({ conversation: [] });
  const el = new CORAConversation();
  el._messages = [];
  el.caseId = 'case-2';
  el.currentUser = CURRENT_USER;
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (makeStubSaveQueue());
  el.connectedCallback();

  const compose = findByClass(el, 'cora-conversation-compose');
  const textarea = findByClass(compose, 'cora-conversation-input');
  const btn = findByClass(compose, 'cora-conversation-send');
  // Simulate environment where .value is null (covers the `?? ''` branch)
  /** @type {any} */ (textarea).value = null;
  await btn._listeners['click'][0]();
  assert.equal(
    client.patchCalls.length,
    0,
    'null textarea value must be treated as empty body'
  );
});

// --- Case Type sectionLabels heading override (MAINT-11) ---

test('CORAConversation: renders the default Conversation heading', () => {
  const el = new CORAConversation();
  el._messages = [];
  el.connectedCallback();

  assert.equal(
    /** @type {any} */ (el)._children[0].textContent,
    'Conversation'
  );
});

test('CORAConversation: heading prop overrides the default heading', () => {
  const el = new CORAConversation();
  el._messages = [];
  el.heading = 'Dialogue';
  el.connectedCallback();

  assert.equal(/** @type {any} */ (el)._children[0].textContent, 'Dialogue');
});
