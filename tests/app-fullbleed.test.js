// @ts-check
// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM stubs so Router can run without a browser.
/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};
/** @type {any} */ (globalThis).location = { hash: '' };

import { Router } from '../src/lib/router.js';

/**
 * Simulate what app.js does for the #/question-bank route:
 * mount adds 'cr-fullbleed' to appEl; unmount removes it.
 */
test('app: cr-fullbleed is added to appEl when #/question-bank mounts', () => {
  const appEl = { classList: new Set() };
  const container = /** @type {any} */ ({});
  const router = new Router();
  router._container = container;

  router.register('#/question-bank', {
    mount() {
      appEl.classList.add('cr-fullbleed');
    },
    unmount() {
      appEl.classList.delete('cr-fullbleed');
    },
  });

  router.navigate('#/question-bank');
  assert.ok(
    appEl.classList.has('cr-fullbleed'),
    'cr-fullbleed should be present on mount'
  );
});

test('app: cr-fullbleed is removed from appEl when navigating away from #/question-bank', () => {
  const appEl = { classList: new Set() };
  const container = /** @type {any} */ ({});
  const router = new Router();
  router._container = container;

  router.register('#/question-bank', {
    mount() {
      appEl.classList.add('cr-fullbleed');
    },
    unmount() {
      appEl.classList.delete('cr-fullbleed');
    },
  });
  router.register('#/dashboard', {
    mount() {},
    unmount() {},
  });

  router.navigate('#/question-bank');
  assert.ok(appEl.classList.has('cr-fullbleed'));

  router.navigate('#/dashboard');
  assert.ok(
    !appEl.classList.has('cr-fullbleed'),
    'cr-fullbleed should be removed on unmount'
  );
});

test('app: other routes do not add cr-fullbleed to appEl', () => {
  const appEl = { classList: new Set() };
  const container = /** @type {any} */ ({});
  const router = new Router();
  router._container = container;

  router.register('#/dashboard', {
    mount() {},
    unmount() {},
  });

  router.navigate('#/dashboard');
  assert.ok(
    !appEl.classList.has('cr-fullbleed'),
    'cr-fullbleed should not be present for other routes'
  );
});
