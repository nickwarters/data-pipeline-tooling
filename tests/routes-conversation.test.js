// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};
/** @type {any} */ (globalThis).location = { hash: '' };

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/conversation.js';

test('conversation route: register calls router.register with #/conversation/:id', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      saveQueue: {},
      currentUser: { id: 'u1' },
    })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/conversation/99')),
    '#/conversation/:id should be registered'
  );
});

test('conversation route: registers source-key conversation route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      saveQueue: {},
      currentUser: { id: 'u1' },
    })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/conversation/example-review/99')),
    '#/conversation/:caseType/:id should be registered'
  );
});

test('conversation route: mount creates cr-conversation-view with correct props', () => {
  const client = {};
  const saveQueue = {};
  const currentUser = { id: 'u42' };
  const elements = /** @type {any[]} */ ([]);

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      const el = /** @type {any} */ ({ tag, setAttribute() {} });
      elements.push(el);
      return el;
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ ({ replaceChildren() {} });

    register(router, /** @type {any} */ ({ client, saveQueue, currentUser }));
    router.navigate('#/conversation/123');

    const el = elements.find((e) => e.tag === 'cr-conversation-view');
    assert.ok(el, 'cr-conversation-view element should be created');
    assert.equal(el.client, client);
    assert.equal(el.saveQueue, saveQueue);
    assert.equal(el.caseId, '123');
    assert.equal(el.caseType, null);
    assert.equal(el.currentUser, currentUser);
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('conversation route: source-key route passes caseType to cr-conversation-view', () => {
  const client = {};
  const saveQueue = {};
  const currentUser = { id: 'u42' };
  const elements = /** @type {any[]} */ ([]);

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      const el = /** @type {any} */ ({ tag, setAttribute() {} });
      elements.push(el);
      return el;
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ ({ replaceChildren() {} });

    register(router, /** @type {any} */ ({ client, saveQueue, currentUser }));
    router.navigate('#/conversation/product-sale-review/123');

    const el = elements.find((e) => e.tag === 'cr-conversation-view');
    assert.ok(el, 'cr-conversation-view element should be created');
    assert.equal(el.caseId, '123');
    assert.equal(el.caseType, 'product-sale-review');
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});
