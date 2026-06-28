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
import { register } from '../src/routes/question-bank.js';

test('question-bank route: register calls router.register with #/question-bank', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  const appEl = { classList: { add() {}, remove() {} } };
  register(router, /** @type {any} */ ({ appEl }));
  assert.ok(
    router._routes.some((r) => r.re.test('#/question-bank')),
    '#/question-bank should be registered'
  );
});

test('question-bank route: mount adds cr-fullbleed to appEl', () => {
  const added = /** @type {string[]} */ ([]);
  const appEl = {
    classList: {
      add(/** @type {string} */ c) {
        added.push(c);
      },
      remove() {},
    },
  };

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
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
    router._container = /** @type {any} */ ({ replaceChildren() {} });
    register(router, /** @type {any} */ ({ appEl }));
    router.navigate('#/question-bank');
    assert.ok(
      added.includes('cr-fullbleed'),
      'cr-fullbleed should be added on mount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('question-bank route: unmount removes cr-fullbleed from appEl', () => {
  const removed = /** @type {string[]} */ ([]);
  const appEl = {
    classList: {
      add() {},
      remove(/** @type {string} */ c) {
        removed.push(c);
      },
    },
  };

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
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
    router._container = /** @type {any} */ ({ replaceChildren() {} });
    register(router, /** @type {any} */ ({ appEl }));
    register(router, /** @type {any} */ ({ appEl })); // register a second route to navigate away to
    const router2 = new Router();
    router2._container = /** @type {any} */ ({ replaceChildren() {} });
    register(router2, /** @type {any} */ ({ appEl }));
    router2.register('#/dashboard', { mount() {}, unmount() {} });
    router2.navigate('#/question-bank');
    router2.navigate('#/dashboard');
    assert.ok(
      removed.includes('cr-fullbleed'),
      'cr-fullbleed should be removed on unmount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('question-bank route: mount creates cr-bank-editor element', () => {
  const created = /** @type {string[]} */ ([]);
  const appEl = { classList: { add() {}, remove() {} } };

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
    router._container = /** @type {any} */ ({ replaceChildren() {} });
    register(router, /** @type {any} */ ({ appEl }));
    router.navigate('#/question-bank');
    assert.ok(
      created.includes('cr-bank-editor'),
      'cr-bank-editor should be created on mount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});
