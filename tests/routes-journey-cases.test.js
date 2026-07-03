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
    /** @type {string[]} */ this.ownedJourneyCaseTypes = [];
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
import { register } from '../src/routes/journey-cases.js';

/** @param {string[]} ownedJourneyCaseTypes */
const ctx = (ownedJourneyCaseTypes) =>
  /** @type {any} */ ({
    client: { id: 'mock' },
    capabilities: { ownedJourneyCaseTypes },
  });

test('routes-journey-cases: registers #/journey-cases route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, ctx(['complaints']));
  assert.ok(
    router._routes.some((r) => r.re.test('#/journey-cases')),
    '#/journey-cases should be registered'
  );
});

test('routes-journey-cases: mounts cr-journey-cases with client and owned types', () => {
  elements.length = 0;
  const router = new Router();
  const container = { replaceChildren(/** @type {any[]} */ ...args) {} };
  router._container = /** @type {any} */ (container);
  register(router, ctx(['complaints', 'example-review']));
  router.navigate('#/journey-cases');

  const el = elements.find((e) => e.tagName === 'CR-JOURNEY-CASES');
  assert.ok(el, 'should create cr-journey-cases element');
  assert.equal(el.client.id, 'mock');
  assert.deepEqual(el.ownedJourneyCaseTypes, ['complaints', 'example-review']);
});

test('routes-journey-cases: non-Journey-Owner is redirected to #/ and no view mounts', () => {
  elements.length = 0;
  /** @type {any} */ (globalThis).location = { hash: '#/journey-cases' };
  const router = new Router();
  const container = { replaceChildren(/** @type {any[]} */ ...args) {} };
  router._container = /** @type {any} */ (container);
  register(router, ctx([]));
  router.navigate('#/journey-cases');

  assert.equal(location.hash, '#/', 'should redirect to home');
  assert.ok(
    !elements.find((e) => e.tagName === 'CR-JOURNEY-CASES'),
    'should not mount the view'
  );
  /** @type {any} */ (globalThis).location = { hash: '' };
});

test('routes-journey-cases: unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, ctx(['complaints']));
  const route = router._routes.find((r) => r.re.test('#/journey-cases'));
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
});
