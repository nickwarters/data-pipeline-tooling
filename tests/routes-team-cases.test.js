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

class StubEl {
  constructor() {
    /** @type {any} */ this.client = null;
    /** @type {any} */ this.currentUser = null;
    /** @type {string[]} */ this.eligibleCaseTypes = [];
    /** @type {string} */ this.queryString = '';
    this.tagName = '';
  }
  replaceChildren() {}
  setAttribute() {}
}
/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).customElements = {
  define() {},
  get() {
    return undefined;
  },
};

/** @type {StubEl[]} */
const elements = [];
/** @type {any} */ (globalThis).document = {
  createElement(/** @type {string} */ tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
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

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/team-cases.js';

test('routes-team-cases: registers #/team-cases route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      eligibleCaseTypes: [],
    })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/team-cases')),
    '#/team-cases should be registered'
  );
});

test('routes-team-cases: mounts cr-team-cases with client, currentUser, eligibleCaseTypes', () => {
  elements.length = 0;
  const client = { id: 'mock' };
  const currentUser = { id: 'u1', displayName: 'U' };
  const eligibleCaseTypes = ['hello-review'];

  const router = new Router();
  const container = { replaceChildren(/** @type {any[]} */ ...args) {} };
  router._container = /** @type {any} */ (container);
  register(
    router,
    /** @type {any} */ ({ client, currentUser, eligibleCaseTypes })
  );
  router.navigate('#/team-cases');

  const el = elements.find((e) => e.tagName === 'CR-TEAM-CASES');
  assert.ok(el, 'should create cr-team-cases element');
  assert.equal(el.client, client);
  assert.equal(el.currentUser, currentUser);
  assert.deepEqual(el.eligibleCaseTypes, eligibleCaseTypes);
});

test('routes-team-cases: unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      eligibleCaseTypes: [],
    })
  );
  const route = router._routes.find((r) => r.re.test('#/team-cases'));
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
});

test('routes-team-cases: passes query string from location hash to element', () => {
  elements.length = 0;
  /** @type {any} */ (globalThis).location = {
    hash: '#/team-cases?manager=me&status=overdue',
  };

  const router = new Router();
  const container = { replaceChildren(/** @type {any[]} */ ...args) {} };
  router._container = /** @type {any} */ (container);
  register(
    router,
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      eligibleCaseTypes: [],
    })
  );
  router.navigate('#/team-cases?manager=me&status=overdue');

  const el = elements.find((e) => e.tagName === 'CR-TEAM-CASES');
  assert.ok(el, 'should create cr-team-cases element');
  assert.ok(el.queryString.includes('manager=me'), 'should pass query string');
  assert.ok(
    el.queryString.includes('status=overdue'),
    'should pass status param'
  );

  /** @type {any} */ (globalThis).location = { hash: '' };
});
