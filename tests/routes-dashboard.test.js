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
const { register } = await import('../src/routes/dashboard.js');

/** @param {any} node @param {string} tag @returns {any|null} */
function findTag(node, tag) {
  if (node.tagName === tag.toUpperCase()) return node;
  for (const c of node._children ?? []) {
    const f = findTag(c, tag);
    if (f) return f;
  }
  return null;
}

test('routes-dashboard: registers #/dashboard route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      capabilities: {
        isReviewer: false,
        ownedCaseTypes: [],
        isAdviser: false,
      },
      caseSources: [],
    })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/dashboard')),
    '#/dashboard should be registered'
  );
});

test('routes-dashboard: mounts DashboardPage output for a reviewer', () => {
  const client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  const currentUser = { id: 'u1' };
  const capabilities = /** @type {any} */ ({
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
  });
  const caseSources = [
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
    /** @type {any} */ ({
      client,
      currentUser,
      capabilities,
      caseSources,
    })
  );
  router.navigate('#/dashboard');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(findTag(mounted[0], 'h1'), 'should render the page heading');
});

test('routes-dashboard: passes allocationSources from context through to the cora-allocation element', () => {
  const client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  const currentUser = { id: 'u1' };
  const capabilities = /** @type {any} */ ({
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
  });
  const allocationSources = [
    { slug: 'example-review', listName: 'Cases-ExampleReview' },
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
    /** @type {any} */ ({
      client,
      currentUser,
      capabilities,
      eligibleCaseTypes: ['example-review'],
      allocationSources,
    })
  );
  router.navigate('#/dashboard');

  const allocationEl = findTag(mounted[0], 'cora-allocation');
  assert.ok(allocationEl, 'should render a cora-allocation element');
  assert.deepEqual(allocationEl.allocationSources, allocationSources);
});

test('routes-dashboard: unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      capabilities: {
        isReviewer: false,
        ownedCaseTypes: [],
        isAdviser: false,
      },
      eligibleCaseTypes: [],
    })
  );
  const route = router._routes.find((r) => r.re.test('#/dashboard'));
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
});

test('routes-dashboard: passes currentUserId and capabilities through to the page', () => {
  const client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  const currentUser = { id: 'u99' };
  const capabilities = /** @type {any} */ ({
    isReviewer: false,
    ownedCaseTypes: ['example-review'],
    isAdviser: false,
  });

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
    /** @type {any} */ ({
      client,
      currentUser,
      capabilities,
      caseSources: [],
    })
  );
  router.navigate('#/dashboard');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(
    findTag(mounted[0], 'cora-owner-summary'),
    'should render the owner summary for owned case types'
  );
});
