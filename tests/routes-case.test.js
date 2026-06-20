// @ts-check
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
import { register } from '../src/routes/case.js';

test('case route: register calls router.register with #/case/:id', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      saveQueue: {},
      currentUser: { id: 'u1' },
      capabilities: {},
    })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/case/99')),
    '#/case/:id should be registered'
  );
});

test('case route: mount creates cr-case-review with correct props', () => {
  const client = {};
  const saveQueue = {};
  const currentUser = { id: 'u7' };
  const capabilities = { canEditBank: false };
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

    register(
      router,
      /** @type {any} */ ({ client, saveQueue, currentUser, capabilities })
    );
    router.navigate('#/case/456');

    const el = elements.find((e) => e.tag === 'cr-case-review');
    assert.ok(el, 'cr-case-review element should be created');
    assert.equal(el.client, client);
    assert.equal(el.saveQueue, saveQueue);
    assert.equal(el.caseId, '456');
    assert.equal(el.currentUserId, 'u7');
    assert.equal(el.capabilities, capabilities);
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});
