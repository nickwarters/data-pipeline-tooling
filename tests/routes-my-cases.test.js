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
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' } })
  );
  assert.equal(registration.has('#/my-cases'), true);
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
  initRouter(router, /** @type {any} */ (container));
  register(router, /** @type {any} */ ({ client, currentUser }));
  await router.navigate('#/my-cases');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(findTag(mounted[0], 'section'), 'should render the page sections');
});

test('routes-my-cases: a rejecting loadPage renders cora-route-error via the router boundary', async () => {
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
    /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' } }),
    () => Promise.reject(new Error('boom'))
  );

  const originalConsoleError = console.error;
  /** @type {any[]} */
  const errors = [];
  console.error = (/** @type {any[]} */ ...args) => errors.push(args);
  try {
    await router.navigate('#/my-cases');
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].className, 'cora-route-error');
  assert.ok(errors.length > 0, 'console.error should have been called');
});

test('routes-my-cases: unmount is a no-op (does not throw)', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({ client: {}, currentUser: { id: 'u1' } })
  );
  assert.doesNotThrow(() => registration.handlerFor('#/my-cases').unmount());
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
  register(router, /** @type {any} */ ({ client, currentUser, caseSources }));
  await router.navigate('#/my-cases');

  assert.equal(mounted.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filter.responsibleParty, 'u99');
  assert.equal(calls[0].opts.listName, 'Cases-ExampleReview');
});

test('routes-my-cases: threads context.caseSources into the page (fans out across multiple sources)', async () => {
  /** @type {any[]} */
  const calls = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ filter, /** @type {any} */ opts) {
      calls.push({ filter, opts });
      return [];
    },
  });
  const currentUser = { id: 'u1' };
  const caseSources = [
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
  initRouter(router, /** @type {any} */ (container));
  register(router, /** @type {any} */ ({ client, currentUser, caseSources }));
  await router.navigate('#/my-cases');

  assert.deepEqual(
    calls.map((c) => c.opts.listName).sort(),
    ['Cases-ExampleReview', 'Cases-StressReview'],
    'one listCases per authorized source'
  );
});
