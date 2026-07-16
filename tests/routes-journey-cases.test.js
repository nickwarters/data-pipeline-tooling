// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};

const { Router } = await import('../src/lib/router.js');
const { register } = await import('../src/routes/journey-cases.js');

/** @param {any} node @param {string} tag @returns {any|null} */
function findTag(node, tag) {
  if (node.tagName === tag.toUpperCase()) return node;
  for (const c of node._children ?? []) {
    const f = findTag(c, tag);
    if (f) return f;
  }
  return null;
}

/**
 * @param {string} slug
 * @param {string} [listName]
 * @returns {import('../src/setup/resolve-eligible-case-types.js').CaseSource}
 */
const src = (slug, listName = `${slug}-list`) => ({
  slug,
  listName,
  displayName: slug,
});

/** @param {string[]} journeySlugs */
const ctx = (journeySlugs) =>
  /** @type {any} */ ({
    client: {
      id: 'mock',
      async listCases() {
        return [];
      },
    },
    journeyCaseSources: journeySlugs.map((s) => src(s)),
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

test('routes-journey-cases: mounts JourneyCasesPage output when owned types exist', async () => {
  const router = new Router();
  /** @type {any[]} */
  let mounted = [];
  const container = {
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  };
  router._container = /** @type {any} */ (container);
  register(router, ctx(['complaints', 'example-review']));
  await router.navigate('#/journey-cases');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(findTag(mounted[0], 'h1'), 'should render the page heading');
});

test('routes-journey-cases: non-Journey-Owner is redirected to #/ and no view mounts', () => {
  /** @type {any} */ (globalThis).location = { hash: '#/journey-cases' };
  const router = new Router();
  /** @type {any[]} */
  let mounted = [];
  const container = {
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  };
  router._container = /** @type {any} */ (container);
  register(router, ctx([]));
  router.navigate('#/journey-cases');

  assert.equal(location.hash, '#/', 'should redirect to home');
  assert.equal(mounted.length, 0, 'should not mount the view');
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

test('routes-journey-cases: a rejecting page load renders a cora-route-error panel', async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const router = new Router();
    /** @type {any[]} */
    let mounted = [];
    const container = {
      replaceChildren(/** @type {any} */ ...args) {
        mounted = args;
      },
    };
    router._container = /** @type {any} */ (container);
    register(router, ctx(['complaints']), () =>
      Promise.reject(new Error('boom'))
    );
    await router.navigate('#/journey-cases');

    assert.equal(mounted.length, 1, 'should mount the error panel');
    assert.equal(
      mounted[0].className,
      'cora-route-error',
      'should render the router error panel'
    );
  } finally {
    console.error = originalConsoleError;
  }
});
