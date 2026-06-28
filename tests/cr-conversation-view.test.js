// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    this.textContent = '';
    this.className = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    /** @type {string} */
    this._tagName = '';
    // Properties that cr-conversation element needs
    /** @type {any} */
    this.client = null;
    /** @type {any} */
    this.saveQueue = null;
    this.caseId = '';
    /** @type {any} */
    this.currentUser = null;
    /** @type {any} */
    this._updateArg = undefined;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    /** @type {any} */ (this)._attrs ??= {};
    /** @type {any} */ (this)._attrs[k] = v;
  }
  update(/** @type {any} */ arg) {
    this._updateArg = arg;
  }
}

/** @type {Record<string, Function[]>} */
const docListeners = {};

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const Ctor = /** @type {any} */ (globalThis).document._registry?.[
      tag.toLowerCase()
    ];
    const el = Ctor ? new Ctor() : new StubEl();
    el._tagName = tag;
    return el;
  },
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (docListeners[t] ??= []).push(h);
  },
  removeEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    if (docListeners[t])
      docListeners[t] = docListeners[t].filter((fn) => fn !== h);
  },
  hidden: false,
  _registry: {},
};
/** @type {any} */ (globalThis).customElements = {
  define(
    /** @type {string} */ tag,
    /** @type {CustomElementConstructor} */ ctor
  ) {
    /** @type {any} */ (globalThis).document._registry[tag.toLowerCase()] =
      ctor;
  },
};
/** @type {any} */ (globalThis).location = { hash: '' };

// ===== IMPORTS (after stubs) =====
const { CRConversationView } =
  await import('../src/pages/cr-conversation-view.js');

// ===== FIXTURES =====

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/sharepoint-client.js').CurrentUser} CurrentUser */

/** @type {CurrentUser} */
const CURRENT_USER = { id: 'user-reviewer', displayName: 'Alex Reviewer' };

/** @type {CaseRow} */
const BASE_CASE = {
  id: 'case-1',
  caseType: 'example-review',
  title: 'Example Review #1',
  status: 'In-progress',
  assignedReviewer: 'user-reviewer',
  responsibleParty: 'user-agent',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'etag-c1-v1',
};

// ===== HELPERS =====

/**
 * The view extends HTMLElement, which TS resolves to the real DOM type, but at
 * runtime HTMLElement is the StubEl above — so the rendered nodes live in the
 * stub's `_children` array. Read them back through the StubEl type.
 * @param {InstanceType<typeof CRConversationView>} el
 * @returns {StubEl[]}
 */
function childrenOf(el) {
  return /** @type {StubEl} */ (/** @type {unknown} */ (el))._children;
}

/**
 * @param {{ title?: string, id?: string, conversation?: any[] } | null} [caseRow]
 */
function makeStubClient(caseRow = BASE_CASE) {
  return {
    async getCase(/** @type {string} */ _id) {
      return caseRow;
    },
  };
}

// ===== TESTS =====

test('CRConversationView: constructor initialises all properties to null/empty', () => {
  const el = new CRConversationView();
  assert.equal(el.client, null);
  assert.equal(el.saveQueue, null);
  assert.equal(el.caseId, '');
  assert.equal(el.currentUser, null);
});

test('CRConversationView: connectedCallback returns early when client is null', async () => {
  const el = new CRConversationView();
  el.caseId = 'case-1';
  // client is null
  await el.connectedCallback();
  assert.deepEqual(
    childrenOf(el),
    [],
    'should not render anything when client is null'
  );
});

test('CRConversationView: connectedCallback returns early when caseId is empty', async () => {
  const el = new CRConversationView();
  el.client = /** @type {any} */ (makeStubClient());
  // caseId is ''
  await el.connectedCallback();
  assert.deepEqual(
    childrenOf(el),
    [],
    'should not render anything when caseId is empty'
  );
});

test('CRConversationView: connectedCallback returns early when getCase returns null', async () => {
  const el = new CRConversationView();
  el.client = /** @type {any} */ (makeStubClient(null));
  el.caseId = 'case-1';
  await el.connectedCallback();
  assert.deepEqual(
    childrenOf(el),
    [],
    'should not render anything when getCase returns null'
  );
});

test('CRConversationView: connectedCallback renders header at _children[0] and conversationEl at _children[1]', async () => {
  const el = new CRConversationView();
  el.client = /** @type {any} */ (makeStubClient());
  el.caseId = 'case-1';
  await el.connectedCallback();

  assert.equal(
    childrenOf(el).length,
    2,
    'should have exactly two top-level children'
  );
  assert.equal(
    childrenOf(el)[0]._tagName,
    'header',
    'first child should be a header'
  );
  assert.equal(
    childrenOf(el)[1]._tagName,
    'cr-conversation',
    'second child should be cr-conversation'
  );
});

test('CRConversationView: header has className cr-conversation-view-header', async () => {
  const el = new CRConversationView();
  el.client = /** @type {any} */ (makeStubClient());
  el.caseId = 'case-1';
  await el.connectedCallback();

  const header = childrenOf(el)[0];
  assert.equal(header.className, 'cr-conversation-view-header');
});

test('CRConversationView: header children are backBtn then h1', async () => {
  const el = new CRConversationView();
  el.client = /** @type {any} */ (makeStubClient());
  el.caseId = 'case-1';
  await el.connectedCallback();

  const header = childrenOf(el)[0];
  assert.equal(header._children.length, 2, 'header should have two children');
  assert.equal(
    header._children[0]._tagName,
    'button',
    'first header child should be button'
  );
  assert.equal(
    header._children[1]._tagName,
    'h1',
    'second header child should be h1'
  );
});

test('CRConversationView: h1 text uses caseRow.title when present', async () => {
  const el = new CRConversationView();
  el.client = /** @type {any} */ (
    makeStubClient({ ...BASE_CASE, title: 'My Case Title' })
  );
  el.caseId = 'case-1';
  await el.connectedCallback();

  const header = childrenOf(el)[0];
  const h1 = header._children[1];
  assert.equal(h1.textContent, 'My Case Title');
});

test('CRConversationView: h1 text falls back to caseRow.id when title is falsy', async () => {
  const el = new CRConversationView();
  el.client = /** @type {any} */ (
    makeStubClient({ ...BASE_CASE, title: '', id: 'case-fallback-id' })
  );
  el.caseId = 'case-fallback-id';
  await el.connectedCallback();

  const header = childrenOf(el)[0];
  const h1 = header._children[1];
  assert.equal(h1.textContent, 'case-fallback-id');
});

test('CRConversationView: back button has correct className, type, and text', async () => {
  const el = new CRConversationView();
  el.client = /** @type {any} */ (makeStubClient());
  el.caseId = 'case-1';
  await el.connectedCallback();

  const header = childrenOf(el)[0];
  const backBtn = header._children[0];
  assert.equal(backBtn.className, 'cr-back-btn');
  assert.equal(backBtn.type, 'button');
  assert.equal(backBtn.textContent, '← My Reviews');
});

test('CRConversationView: back button click sets location.hash to #/my-reviews', async () => {
  const el = new CRConversationView();
  el.client = /** @type {any} */ (makeStubClient());
  el.caseId = 'case-1';
  await el.connectedCallback();

  const header = childrenOf(el)[0];
  const backBtn = header._children[0];
  // reset hash
  /** @type {any} */ (globalThis).location.hash = '';
  backBtn._listeners['click'][0]();
  assert.equal(/** @type {any} */ (globalThis).location.hash, '#/my-reviews');
});

test('CRConversationView: cr-conversation element receives client, saveQueue, caseId, currentUser from view', async () => {
  const client = makeStubClient();
  const saveQueue = { dummy: true };
  const el = new CRConversationView();
  el.client = /** @type {any} */ (client);
  el.saveQueue = /** @type {any} */ (saveQueue);
  el.caseId = 'case-1';
  el.currentUser = CURRENT_USER;
  await el.connectedCallback();

  const conversationEl = childrenOf(el)[1];
  assert.equal(
    conversationEl.client,
    client,
    'client should be set on conversation element'
  );
  assert.equal(
    conversationEl.saveQueue,
    saveQueue,
    'saveQueue should be set on conversation element'
  );
  assert.equal(
    conversationEl.caseId,
    'case-1',
    'caseId should be set on conversation element'
  );
  assert.equal(
    conversationEl.currentUser,
    CURRENT_USER,
    'currentUser should be set on conversation element'
  );
});

test('CRConversationView: cr-conversation is passed messages from caseRow', async () => {
  const conversation = [
    { author: 'Alice', timestamp: '2026-05-01T10:00:00Z', body: 'Hello!' },
  ];
  const el = new CRConversationView();
  el.client = /** @type {any} */ (
    makeStubClient({ ...BASE_CASE, conversation })
  );
  el.caseId = 'case-1';
  await el.connectedCallback();

  const conversationEl = childrenOf(el)[1];
  assert.deepEqual(
    /** @type {any} */ (conversationEl)._messages,
    conversation,
    'messages should be set from caseRow.conversation'
  );
});
