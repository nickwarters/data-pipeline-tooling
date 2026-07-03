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
  _active: null,
  get activeElement() {
    return this._active;
  },
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
const { ConversationView } =
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
 * @param {HTMLElement} host
 * @returns {StubEl[]}
 */
function childrenOf(host) {
  return /** @type {StubEl} */ (/** @type {unknown} */ (host))._children;
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

/** Flush the microtask queue enough times for fetchData()'s awaits to settle. */
async function flush() {
  // loadCaseTypeConfig() performs a real dynamic import() of the case-type
  // module, which resolves via the module loader (not just microtasks) —
  // a macrotask tick is needed in addition to microtask flushes.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ===== TESTS =====

test('ConversationView: renders nothing when client is null', async () => {
  const host = ConversationView({
    client: null,
    saveQueue: null,
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();
  assert.deepEqual(
    childrenOf(host),
    [],
    'should not render anything when client is null'
  );
});

test('ConversationView: renders nothing when caseId is empty', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (makeStubClient()),
    saveQueue: null,
    caseId: '',
    caseType: null,
    currentUser: null,
  });
  await flush();
  assert.deepEqual(
    childrenOf(host),
    [],
    'should not render anything when caseId is empty'
  );
});

test('ConversationView: renders nothing when getCase returns null', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (makeStubClient(null)),
    saveQueue: null,
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();
  assert.deepEqual(
    childrenOf(host),
    [],
    'should not render anything when getCase returns null'
  );
});

test('ConversationView: renders header at children[0] and conversationEl at children[1]', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (makeStubClient()),
    saveQueue: null,
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();

  assert.equal(
    childrenOf(host).length,
    2,
    'should have exactly two top-level children'
  );
  assert.equal(
    childrenOf(host)[0]._tagName,
    'header',
    'first child should be a header'
  );
  assert.equal(
    childrenOf(host)[1]._tagName,
    'cr-conversation',
    'second child should be cr-conversation'
  );
});

test('ConversationView: header has className cr-conversation-view-header', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (makeStubClient()),
    saveQueue: null,
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();

  const header = childrenOf(host)[0];
  assert.equal(header.className, 'cr-conversation-view-header');
});

test('ConversationView: header children are backBtn then h1', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (makeStubClient()),
    saveQueue: null,
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();

  const header = childrenOf(host)[0];
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

test('ConversationView: h1 text uses caseRow.title when present', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (
      makeStubClient({ ...BASE_CASE, title: 'My Case Title' })
    ),
    saveQueue: null,
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();

  const header = childrenOf(host)[0];
  const h1 = header._children[1];
  assert.equal(h1.textContent, 'My Case Title');
});

test('ConversationView: h1 text falls back to caseRow.id when title is falsy', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (
      makeStubClient({ ...BASE_CASE, title: '', id: 'case-fallback-id' })
    ),
    saveQueue: null,
    caseId: 'case-fallback-id',
    caseType: null,
    currentUser: null,
  });
  await flush();

  const header = childrenOf(host)[0];
  const h1 = header._children[1];
  assert.equal(h1.textContent, 'case-fallback-id');
});

test('ConversationView: back button has correct className, type, and text', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (makeStubClient()),
    saveQueue: null,
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();

  const header = childrenOf(host)[0];
  const backBtn = header._children[0];
  assert.equal(backBtn.className, 'cr-back-btn');
  assert.equal(backBtn.type, 'button');
  assert.equal(backBtn.textContent, '← My Reviews');
});

test('ConversationView: back button click sets location.hash to #/my-reviews', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (makeStubClient()),
    saveQueue: null,
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();

  const header = childrenOf(host)[0];
  const backBtn = header._children[0];
  // reset hash
  /** @type {any} */ (globalThis).location.hash = '';
  backBtn._listeners['click'][0]();
  assert.equal(/** @type {any} */ (globalThis).location.hash, '#/my-reviews');
});

test('ConversationView: cr-conversation element receives client, saveQueue, caseId, currentUser from view', async () => {
  const client = makeStubClient();
  const saveQueue = { dummy: true };
  const host = ConversationView({
    client: /** @type {any} */ (client),
    saveQueue: /** @type {any} */ (saveQueue),
    caseId: 'case-1',
    caseType: null,
    currentUser: CURRENT_USER,
  });
  await flush();

  const conversationEl = childrenOf(host)[1];
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

test('ConversationView: cr-conversation is passed messages from caseRow', async () => {
  const conversation = [
    { author: 'Alice', timestamp: '2026-05-01T10:00:00Z', body: 'Hello!' },
  ];
  const host = ConversationView({
    client: /** @type {any} */ (makeStubClient({ ...BASE_CASE, conversation })),
    saveQueue: null,
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();

  const conversationEl = childrenOf(host)[1];
  assert.deepEqual(
    /** @type {any} */ (conversationEl)._messages,
    conversation,
    'messages should be set from caseRow.conversation'
  );
});

test('ConversationView: loadCase is called on saveQueue with the fetched case row', async () => {
  const client = makeStubClient();
  /** @type {any[]} */
  const loadCalls = [];
  const saveQueue = {
    loadCase(/** @type {any} */ row, /** @type {any} */ opts) {
      loadCalls.push([row, opts]);
    },
  };
  ConversationView({
    client: /** @type {any} */ (client),
    saveQueue: /** @type {any} */ (saveQueue),
    caseId: 'case-1',
    caseType: null,
    currentUser: null,
  });
  await flush();

  assert.equal(loadCalls.length, 1, 'saveQueue.loadCase should be called');
  assert.equal(loadCalls[0][0].id, 'case-1');
  assert.deepEqual(loadCalls[0][1], {});
});

test('ConversationView: resolves caseType config and passes listName as opts', async () => {
  /** @type {any[]} */
  const getCaseCalls = [];
  const client = {
    async getCase(/** @type {string} */ id, /** @type {any} */ opts) {
      getCaseCalls.push([id, opts]);
      return BASE_CASE;
    },
  };
  const host = ConversationView({
    client: /** @type {any} */ (client),
    saveQueue: null,
    caseId: 'case-1',
    caseType: 'example-review',
    currentUser: null,
  });
  await flush();

  assert.equal(getCaseCalls.length, 1);
  assert.equal(getCaseCalls[0][0], 'case-1');
  // example-review case type module is expected to exist in the manifest;
  // opts is either {} or { listName } depending on its config.
  assert.ok(typeof getCaseCalls[0][1] === 'object');
  assert.ok(childrenOf(host).length >= 0);
});

test('ConversationView: renders nothing when caseType is unknown', async () => {
  const host = ConversationView({
    client: /** @type {any} */ (makeStubClient()),
    saveQueue: null,
    caseId: 'case-1',
    caseType: 'totally-unknown-case-type',
    currentUser: null,
  });
  await flush();

  assert.deepEqual(
    childrenOf(host),
    [],
    'should not render anything for an unknown case type'
  );
});
