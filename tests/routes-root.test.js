// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

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

test('root route: mount renders HomePage sections with capabilities from context (no redirect)', async () => {
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
  const capabilities = {
    isVisitor: true,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
  };

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
    await router.navigate('#/');

    assert.equal(rendered.length, 1, 'one home section rendered');
    assert.equal(rendered[0].tagName, 'SECTION');
    assert.equal(rendered[0]._children[0].textContent, 'Visitor');
    assert.deepEqual(hashes, [], 'no redirect away from #/');
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
    /** @type {any} */ (globalThis).location = origLocation;
  }
});

test('root route: rejecting loadPage renders cora-route-error into the router container', async () => {
  const origConsoleError = console.error;
  console.error = () => {};

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return /** @type {any} */ ({
        tagName: tag.toUpperCase(),
        textContent: '',
        className: '',
        _children: /** @type {any[]} */ ([]),
        appendChild(/** @type {any} */ child) {
          this._children.push(child);
          return child;
        },
      });
    },
  };

  const containerChildren = /** @type {any[]} */ ([]);
  const container = {
    replaceChildren(/** @type {any[]} */ ...children) {
      containerChildren.splice(0, containerChildren.length, ...children);
    },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ (container);
    const appEl = { replaceChildren() {} };
    const capabilities = {
      isVisitor: true,
      ownedCaseTypes: [],
      ownedJourneyCaseTypes: [],
    };
    register(router, /** @type {any} */ ({ appEl, capabilities }), () =>
      Promise.reject(new Error('boom'))
    );
    await router.navigate('#/');

    assert.equal(containerChildren.length, 1);
    assert.equal(containerChildren[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('root route: unmount clears appEl', async () => {
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
      /** @type {any} */ ({
        capabilities: { ownedCaseTypes: [], ownedJourneyCaseTypes: [] },
        appEl,
      })
    );
    await router.navigate('#/');
    // Navigating elsewhere triggers the root handler's unmount.
    router.register('#/other', { mount() {}, unmount() {} });
    await router.navigate('#/other');

    assert.deepEqual(
      replaceCalls,
      [0, 0],
      'mount renders nothing for empty capabilities and unmount clears appEl'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});
