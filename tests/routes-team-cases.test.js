// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, waitForRender } from './_dom-stub.js';
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
const { register } = await import('../src/routes/team-cases.js');

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

/** @param {any} node @param {string} tag @returns {any|null} */
function findTag(node, tag) {
  if (node.tagName === tag.toUpperCase()) return node;
  for (const c of node._children ?? []) {
    const f = findTag(c, tag);
    if (f) return f;
  }
  return null;
}

test('routes-team-cases: registers #/team-cases route', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  assert.equal(registration.has('#/team-cases'), true);
});

test('routes-team-cases: mounts TeamCasesPage output with client, currentUser, caseSources', async () => {
  const client = /** @type {any} */ ({
    async listCases() {
      return [];
    },
  });
  const currentUser = { id: 'u1', displayName: 'U' };
  const caseSources = [src('example-review')];

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
  await router.navigate('#/team-cases');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(findTag(mounted[0], 'h1'), 'should render the page heading');
});

test('routes-team-cases: unmount is a no-op (does not throw)', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  assert.doesNotThrow(() => registration.handlerFor('#/team-cases').unmount());
});

test('routes-team-cases: passes query string from location hash to the page', async () => {
  /** @type {any} */ (globalThis).location = {
    hash: '#/team-cases?manager=me&status=overdue',
  };

  /** @type {import('../src/sharepoint-client.js').ListCasesFilter[]} */
  const calls = [];
  const client = /** @type {any} */ ({
    async listCases(/** @type {any} */ f) {
      calls.push(f);
      return [];
    },
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
      currentUser: { id: 'u1' },
      caseSources: ['example-review'].map((s) => src(s)),
    })
  );
  await router.navigate('#/team-cases?manager=me&status=overdue');
  await waitForRender(mounted[0]);

  assert.equal(mounted.length, 1);
  assert.equal(calls.length, 1, 'should fetch using the parsed query string');
  assert.equal(calls[0].assignedReviewerManager, 'u1');

  /** @type {any} */ (globalThis).location = { hash: '' };
});

test('routes-team-cases: rejecting loadPage renders a route error panel', async () => {
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
      caseSources: [],
    }),
    () => Promise.reject(new Error('boom'))
  );

  const origError = console.error;
  console.error = () => {};
  try {
    await router.navigate('#/team-cases');
  } finally {
    console.error = origError;
  }

  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].className, 'cora-route-error');
});
