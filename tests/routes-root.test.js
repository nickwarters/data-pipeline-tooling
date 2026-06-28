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

test('root route: mount renders HomePage sections with capabilities from context (no redirect)', () => {
  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      const el = /** @type {any} */ ({
        tagName: tag.toUpperCase(),
        textContent: '',
        className: '',
        href: '',
        _children: /** @type {any[]} */ ([]),
        appendChild(/** @type {any} */ child) {
          this._children.push(child);
          return child;
        },
        setAttribute() {},
      });
      return el;
    },
    createTextNode(/** @type {string} */ text) {
      return /** @type {any} */ ({
        tagName: '#text',
        textContent: text,
        _children: [],
      });
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  const rendered = /** @type {any[]} */ ([]);
  const appEl = {
    replaceChildren(/** @type {any[]} */ ...children) {
      rendered.splice(0, rendered.length, ...children);
    },
  };
  const capabilities = { isVisitor: true, ownedCaseTypes: [] };

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

    assert.equal(rendered.length, 1, 'one home section rendered');
    assert.equal(rendered[0].tagName, 'SECTION');
    assert.equal(rendered[0]._children[0].textContent, 'Visitor');
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

  /** @type {number[]} */
  const replaceCalls = [];
  const appEl = {
    replaceChildren(/** @type {any[]} */ ...children) {
      replaceCalls.push(children.length);
    },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ ({});
    register(
      router,
      /** @type {any} */ ({ capabilities: { ownedCaseTypes: [] }, appEl })
    );
    router.navigate('#/');
    // Navigating elsewhere triggers the root handler's unmount.
    router.register('#/other', { mount() {}, unmount() {} });
    router.navigate('#/other');

    assert.deepEqual(
      replaceCalls,
      [0, 0],
      'mount renders nothing for empty capabilities and unmount clears appEl'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});
