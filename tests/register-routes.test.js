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
import { registerRoutes } from '../src/register-routes.js';

/** @returns {import('../src/register-routes.js').AppContext} */
function makeContext() {
  return /** @type {any} */ ({
    client: {},
    saveQueue: {},
    currentUser: { id: 'u1' },
    capabilities: {},
    eligibleCaseTypes: [],
    appEl: { classList: { add() {}, remove() {} }, setAttribute() {} },
  });
}

test('registerRoutes: registers #/ route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(router._routes.some(r => r.re.test('#/')), '#/ should be registered');
});

test('registerRoutes: registers #/dashboard route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(router._routes.some(r => r.re.test('#/dashboard')), '#/dashboard should be registered');
});

test('registerRoutes: registers #/conversation/:id route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(router._routes.some(r => r.re.test('#/conversation/99')), '#/conversation/:id should be registered');
});

test('registerRoutes: registers #/question-bank route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(router._routes.some(r => r.re.test('#/question-bank')), '#/question-bank should be registered');
});

test('registerRoutes: registers #/case/:id route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());
  assert.ok(router._routes.some(r => r.re.test('#/case/99')), '#/case/:id should be registered');
});

test('registerRoutes: #/ mount redirects to #/dashboard', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  registerRoutes(router, makeContext());

  const locations = /** @type {string[]} */ ([]);
  const origLocation = globalThis.location;
  (/** @type {any} */ (globalThis)).location = {
    get hash() { return origLocation.hash; },
    set hash(v) { locations.push(v); },
  };

  try {
    router.navigate('#/');
    assert.deepEqual(locations, ['#/dashboard']);
  } finally {
    (/** @type {any} */ (globalThis)).location = origLocation;
  }
});

test('registerRoutes: #/dashboard mount creates cr-dashboard element', () => {
  const created = /** @type {string[]} */ ([]);
  const origCreate = globalThis.document?.createElement;
  (/** @type {any} */ (globalThis)).document = {
    createElement(/** @type {string} */ tag) { created.push(tag); return { setAttribute() {} }; },
    createTreeWalker() { return { nextNode() { return null; } }; },
  };

  try {
    const router = new Router();
    const container = { replaceChildren() {} };
    router._container = /** @type {any} */ (container);
    registerRoutes(router, makeContext());
    router.navigate('#/dashboard');
    assert.ok(created.includes('cr-dashboard'), 'cr-dashboard should be created on mount');
  } finally {
    if (origCreate) {
      (/** @type {any} */ (globalThis)).document = { createElement: origCreate };
    } else {
      delete (/** @type {any} */ (globalThis)).document;
    }
  }
});

test('registerRoutes: #/question-bank mount adds cr-fullbleed to appEl', () => {
  const router = new Router();
  const container = { replaceChildren() {} };
  router._container = /** @type {any} */ (container);
  const appEl = { classList: { added: /** @type {string[]} */ ([]), add(/** @type {string} */ c) { this.added.push(c); }, remove() {} }, setAttribute() {} };
  const ctx = /** @type {any} */ ({ ...makeContext(), appEl });

  registerRoutes(router, ctx);

  const origCreate = (/** @type {any} */ (globalThis)).document;
  (/** @type {any} */ (globalThis)).document = {
    createElement(/** @type {string} */ tag) { return { setAttribute() {} }; },
    createTreeWalker() { return { nextNode() { return null; } }; },
  };
  try {
    router.navigate('#/question-bank');
    assert.ok(appEl.classList.added.includes('cr-fullbleed'), 'cr-fullbleed added on mount');
  } finally {
    (/** @type {any} */ (globalThis)).document = origCreate;
  }
});

test('registerRoutes: #/question-bank unmount removes cr-fullbleed from appEl', () => {
  const router = new Router();
  const container = { replaceChildren() {} };
  router._container = /** @type {any} */ (container);
  const removed = /** @type {string[]} */ ([]);
  const appEl = { classList: { add() {}, remove(/** @type {string} */ c) { removed.push(c); } }, setAttribute() {} };
  const ctx = /** @type {any} */ ({ ...makeContext(), appEl });

  registerRoutes(router, ctx);

  const origCreate = (/** @type {any} */ (globalThis)).document;
  (/** @type {any} */ (globalThis)).document = {
    createElement(/** @type {string} */ tag) { return { setAttribute() {} }; },
    createTreeWalker() { return { nextNode() { return null; } }; },
  };
  try {
    router.navigate('#/question-bank');
    router.navigate('#/dashboard');
    assert.ok(removed.includes('cr-fullbleed'), 'cr-fullbleed removed on unmount');
  } finally {
    (/** @type {any} */ (globalThis)).document = origCreate;
  }
});
