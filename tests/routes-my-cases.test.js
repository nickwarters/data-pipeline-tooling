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
const { register } = await import('../src/routes/my-cases.js');

/** @param {any} node @param {string} tag @returns {any|null} */
function findTag(node, tag) {
  if (node.tagName === tag.toUpperCase()) return node;
  for (const c of node._children ?? []) {
    const f = findTag(c, tag);
    if (f) return f;
  }
  return null;
}

test('routes-my-cases: registers #/my-cases route', () => {
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

test('routes-my-cases: mounts ResponsiblePartyDashboard output', async () => {
  const client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  const currentUser = { id: 'u1' };

  const router = new Router();
  /** @type {any[]} */
  let mounted = [];
  const container = {
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  };
  router._container = /** @type {any} */ (container);
  register(router, /** @type {any} */ ({ client, currentUser }));
  router.navigate('#/my-cases');

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(findTag(mounted[0], 'section'), 'should render the page sections');
});

test('routes-my-cases: unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' } })
  );
  const route = router._routes.find((r) => r.re.test('#/my-cases'));
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
});

test('routes-my-cases: passes client and currentUserId through to the page without wiring onOpenConversation (matches previous behaviour)', async () => {
  /** @type {Array<{ filter: any, opts: any }>} */
  const calls = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter, /** @type {any} */ opts) {
      calls.push({ filter, opts });
      return [];
    },
  });
  const currentUser = { id: 'u99' };
  const allCaseSources = [
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      displayName: 'Example Review',
    },
  ];

  const router = new Router();
  /** @type {any[]} */
  let mounted = [];
  const container = {
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  };
  router._container = /** @type {any} */ (container);
  register(
    router,
    /** @type {any} */ ({ client, currentUser, allCaseSources })
  );
  router.navigate('#/my-cases');

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(mounted.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filter.responsibleParty, 'u99');
  assert.equal(calls[0].opts.listName, 'Cases-ExampleReview');
});

test('routes-my-cases: threads context.allCaseSources into the page (fans out across multiple sources)', async () => {
  /** @type {any[]} */
  const calls = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter, /** @type {any} */ opts) {
      calls.push({ filter, opts });
      return [];
    },
  });
  const currentUser = { id: 'u1' };
  const allCaseSources = [
    {
      slug: 'example-review',
      listName: 'Cases-ExampleReview',
      displayName: 'Example Review',
    },
    {
      slug: 'stress-review',
      listName: 'Cases-StressReview',
      displayName: 'Stress Review',
    },
  ];

  const router = new Router();
  const container = { replaceChildren() {} };
  router._container = /** @type {any} */ (container);
  register(
    router,
    /** @type {any} */ ({ client, currentUser, allCaseSources })
  );
  router.navigate('#/my-cases');

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(
    calls.map((c) => c.opts.listName).sort(),
    ['Cases-ExampleReview', 'Cases-StressReview'],
    'one listCases per source in allCaseSources'
  );
});
