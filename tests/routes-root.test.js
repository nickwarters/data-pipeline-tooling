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

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/root.js';

test('root route: register calls router.register with #/', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, /** @type {any} */ ({}));
  assert.ok(router._routes.some(r => r.re.test('#/')), '#/ should be registered');
});

test('root route: mount sets location.hash to #/dashboard', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, /** @type {any} */ ({}));

  const hashes = /** @type {string[]} */ ([]);
  const origLocation = globalThis.location;
  (/** @type {any} */ (globalThis)).location = {
    get hash() { return origLocation.hash; },
    set hash(v) { hashes.push(v); },
  };
  try {
    router.navigate('#/');
    assert.deepEqual(hashes, ['#/dashboard']);
  } finally {
    (/** @type {any} */ (globalThis)).location = origLocation;
  }
});
