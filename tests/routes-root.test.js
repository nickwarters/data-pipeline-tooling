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
import { register } from '../src/routes/root.js';

test('root route: register calls router.register with #/', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, /** @type {any} */ ({}));
  assert.ok(
    router._routes.some((r) => r.re.test('#/')),
    '#/ should be registered'
  );
});

test('root route: mount appends a cr-home with capabilities from context (no redirect)', () => {
  const created = /** @type {any[]} */ ([]);
  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      const el = /** @type {any} */ ({ tag, setAttribute() {} });
      created.push(el);
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

  const appended = /** @type {any[]} */ ([]);
  const appEl = {
    appendChild(/** @type {any} */ el) {
      appended.push(el);
      return el;
    },
  };
  const capabilities = { isVisitor: true };

  const hashes = /** @type {string[]} */ ([]);
  const origLocation = globalThis.location;
  /** @type {any} */ (globalThis).location = {
    get hash() {
      return '';
    },
    set hash(v) {
      hashes.push(v);
    },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ ({});
    register(router, /** @type {any} */ ({ capabilities, appEl }));
    router.navigate('#/');

    const home = created.find((e) => e.tag === 'cr-home');
    assert.ok(home, 'cr-home element should be created');
    assert.equal(
      home.capabilities,
      capabilities,
      'capabilities assigned from context'
    );
    assert.equal(appended.length, 1, 'cr-home appended to appEl once');
    assert.equal(appended[0], home, 'the appended element is the cr-home');
    assert.deepEqual(hashes, [], 'no redirect away from #/');
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
    /** @type {any} */ (globalThis).location = origLocation;
  }
});

test('root route: unmount clears appEl', () => {
  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement() {
      return /** @type {any} */ ({ setAttribute() {} });
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  let cleared = 0;
  const appEl = {
    appendChild() {},
    replaceChildren() {
      cleared++;
    },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ ({});
    register(router, /** @type {any} */ ({ capabilities: {}, appEl }));
    router.navigate('#/');
    // Navigating elsewhere triggers the root handler's unmount.
    router.register('#/other', { mount() {}, unmount() {} });
    router.navigate('#/other');

    assert.equal(cleared, 1, 'unmount should clear appEl once');
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});
