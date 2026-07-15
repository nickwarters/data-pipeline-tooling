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
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/team-cases')),
    '#/team-cases should be registered'
  );
});

test('routes-team-cases: mounts TeamCasesPage output with client, currentUser, eligibleCaseTypes', () => {
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
  router._container = /** @type {any} */ (container);
  register(router, /** @type {any} */ ({ client, currentUser, caseSources }));
  router.navigate('#/team-cases');

  assert.equal(mounted.length, 1, 'should mount a single host element');
  assert.ok(findTag(mounted[0], 'h1'), 'should render the page heading');
});

test('routes-team-cases: unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  const route = router._routes.find((r) => r.re.test('#/team-cases'));
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
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
  router._container = /** @type {any} */ (container);
  register(
    router,
    /** @type {any} */ ({
      client,
      currentUser: { id: 'u1' },
      caseSources: ['example-review'].map((s) => src(s)),
    })
  );
  router.navigate('#/team-cases?manager=me&status=overdue');

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(mounted.length, 1);
  assert.equal(calls.length, 1, 'should fetch using the parsed query string');
  assert.equal(calls[0].assignedReviewerManager, 'u1');

  /** @type {any} */ (globalThis).location = { hash: '' };
});
