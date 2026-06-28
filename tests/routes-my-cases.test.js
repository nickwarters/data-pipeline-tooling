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
import { register } from '../src/routes/my-cases.js';

test('my-cases route: register calls router.register with #/my-cases', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' } })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/my-cases')),
    '#/my-cases should be registered'
  );
});

test('my-cases route: mount creates and mounts cr-responsible-party-dashboard element', () => {
  const created = /** @type {string[]} */ ([]);
  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      created.push(tag);
      return { setAttribute() {} };
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
    const replaced = /** @type {unknown[]} */ ([]);
    const container = {
      replaceChildren(/** @type {unknown[]} */ ...args) {
        replaced.push(...args);
      },
    };
    router._container = /** @type {any} */ (container);

    register(
      router,
      /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' } })
    );
    router.navigate('#/my-cases');
    // Re-navigate to exercise the (no-op) unmount of the current route.
    router.navigate('#/my-cases');

    assert.ok(
      created.includes('cr-responsible-party-dashboard'),
      'cr-responsible-party-dashboard element should be created'
    );
    assert.equal(
      replaced.length,
      2,
      'replaceChildren should be called on each mount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('my-cases route: mount sets client and currentUserId on element', () => {
  const client = { id: 'client' };
  const currentUser = { id: 'u99' };

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

    register(router, /** @type {any} */ ({ client, currentUser }));
    router.navigate('#/my-cases');

    const el = elements.find((e) => e.tag === 'cr-responsible-party-dashboard');
    assert.ok(el, 'cr-responsible-party-dashboard element should exist');
    assert.equal(el.client, client);
    assert.equal(el.currentUserId, 'u99');
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});
