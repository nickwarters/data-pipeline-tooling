// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Record<string, Function[]>} */
const windowListeners = {};
(/** @type {any} */ (globalThis)).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};
(/** @type {any} */ (globalThis)).location = { hash: '' };

import { Router } from '../src/router.js';
import { register } from '../src/routes/dashboard.js';

test('dashboard route: register calls router.register with #/dashboard', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' }, capabilities: {}, eligibleCaseTypes: [] }));
  assert.ok(router._routes.some(r => r.re.test('#/dashboard')), '#/dashboard should be registered');
});

test('dashboard route: mount creates and mounts cr-dashboard element', () => {
  const created = /** @type {string[]} */ ([]);
  const origDoc = (/** @type {any} */ (globalThis)).document;
  (/** @type {any} */ (globalThis)).document = {
    createElement(/** @type {string} */ tag) { created.push(tag); return { setAttribute() {} }; },
    createTreeWalker() { return { nextNode() { return null; } }; },
  };

  try {
    const router = new Router();
    const replaced = /** @type {unknown[]} */ ([]);
    const container = { replaceChildren(/** @type {unknown[]} */ ...args) { replaced.push(...args); } };
    router._container = /** @type {any} */ (container);

    register(router, /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' }, capabilities: {}, eligibleCaseTypes: [] }));
    router.navigate('#/dashboard');

    assert.ok(created.includes('cr-dashboard'), 'cr-dashboard element should be created');
    assert.equal(replaced.length, 1, 'replaceChildren should be called once');
  } finally {
    (/** @type {any} */ (globalThis)).document = origDoc;
  }
});

test('dashboard route: mount sets client, currentUserId, capabilities, eligibleCaseTypes on element', () => {
  const client = { id: 'client' };
  const capabilities = { canEditBank: true };
  const eligibleCaseTypes = ['hello-review'];
  const currentUser = { id: 'u99' };

  const elements = /** @type {any[]} */ ([]);
  const origDoc = (/** @type {any} */ (globalThis)).document;
  (/** @type {any} */ (globalThis)).document = {
    createElement(/** @type {string} */ tag) {
      const el = /** @type {any} */ ({ tag, setAttribute() {} });
      elements.push(el);
      return el;
    },
    createTreeWalker() { return { nextNode() { return null; } }; },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ ({ replaceChildren() {} });

    register(router, /** @type {any} */ ({ client, currentUser, capabilities, eligibleCaseTypes }));
    router.navigate('#/dashboard');

    const el = elements.find(e => e.tag === 'cr-dashboard');
    assert.ok(el, 'cr-dashboard element should exist');
    assert.equal(el.client, client);
    assert.equal(el.currentUserId, 'u99');
    assert.equal(el.capabilities, capabilities);
    assert.equal(el.eligibleCaseTypes, eligibleCaseTypes);
  } finally {
    (/** @type {any} */ (globalThis)).document = origDoc;
  }
});
