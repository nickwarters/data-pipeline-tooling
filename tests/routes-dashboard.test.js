// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { initRouter, routeRegistrationSpy } from './helpers/router.js';

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
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
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
  assert.equal(registration.has('#/dashboard'), true);
});

test('routes-dashboard: mounts DashboardPage output for a reviewer', async () => {
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
  initRouter(router, /** @type {any} */ (container));
  register(
    router,
    /** @type {any} */ ({
      client,
      currentUser,
      capabilities,
      caseSources,
    })
  );
  await router.navigate('#/dashboard');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(findTag(mounted[0], 'h1'), 'should render the page heading');
});

test('routes-dashboard: passes allocationSources from context through to the cora-allocation element', async () => {
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
  initRouter(router, /** @type {any} */ (container));
  register(
    router,
    /** @type {any} */ ({
      client,
      currentUser,
      capabilities,
      allocationSources,
    })
  );
  await router.navigate('#/dashboard');

  const allocationEl = findTag(mounted[0], 'cora-allocation');
  assert.ok(allocationEl, 'should render a cora-allocation element');
  assert.deepEqual(allocationEl.allocationSources, allocationSources);
});

test('routes-dashboard: unmount is a no-op (does not throw)', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      capabilities: {
        isReviewer: false,
        ownedCaseTypes: [],
        isAdviser: false,
      },
    })
  );
  assert.doesNotThrow(() => registration.handlerFor('#/dashboard').unmount());
});

test('routes-dashboard: renders a cora-route-error panel when the page module fails to load', async () => {
  const origConsoleError = console.error;
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
    initRouter(router, /** @type {any} */ (container));
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
      }),
      () => Promise.reject(new Error('boom'))
    );
    await router.navigate('#/dashboard');

    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
  }
});

test('routes-dashboard: passes currentUserId and capabilities through to the page', async () => {
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
  initRouter(router, /** @type {any} */ (container));
  register(
    router,
    /** @type {any} */ ({
      client,
      currentUser,
      capabilities,
      caseSources: [],
    })
  );
  await router.navigate('#/dashboard');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(
    findTag(mounted[0], 'cora-owner-summary'),
    'should render the owner summary for owned case types'
  );
});
