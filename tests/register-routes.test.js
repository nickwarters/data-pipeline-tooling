// @ts-check

/**
 * The route table — and the ten `tests/routes-*.test.js` files it replaces.
 *
 * Those files each re-asserted the same four things — "registers its URL",
 * "mounts and disposes", "a rejecting page loader is contained", "unmount
 * disposes the slice" — against an injected fake page. All four are properties
 * of `createStoreRoute` and `Router`, covered once each in `store-route.test.js`
 * and `router.test.js`; repeating them per route tested the adapter ten times
 * over and the route itself not at all.
 *
 * What is genuinely per-route is here: the paths each route claims, the two
 * multi-path routes, the Journey Owner guard, and the one page the dev harness
 * overrides. Plus one thing the per-route tests could not check, because they all
 * injected fakes — that every `load` thunk in the table resolves to a real page
 * module exposing `createRouteSlice`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

/** @type {string[]} */
const replacedUrls = [];
/** @type {any} */ (globalThis).location = {
  hash: '',
  pathname: '/SitePages/app.aspx',
  search: '',
  replace: (/** @type {string} */ url) => replacedUrls.push(url),
};

const { routeTable, registerRoutes } =
  await import('../src/setup/register-routes.js');

/**
 * @param {string[]} journeyCaseSources
 * @returns {import('../src/setup/register-routes.js').AppContext}
 */
function makeContext(journeyCaseSources = ['complaints']) {
  return /** @type {any} */ ({
    client: {},
    saveQueue: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/' },
      currentUser: { id: 'u1', displayName: 'A User' },
      permissions: {},
    },
    caseSources: [],
    journeyCaseSources,
    allocationSources: [],
    appEl: {
      classList: { add() {}, remove() {} },
      setAttribute() {},
      appendChild() {},
      replaceChildren() {},
    },
  });
}

test('registerRoutes: registers the complete public route contract, in order', () => {
  /** @type {string[]} */
  const patterns = [];
  registerRoutes(
    /** @type {any} */ ({
      register: (/** @type {string} */ pattern) => patterns.push(pattern),
    }),
    makeContext()
  );

  assert.deepEqual(patterns, [
    '#/',
    '#/dashboard',
    '#/conversation/:caseType/:id',
    '#/conversation/:id',
    '#/question-bank',
    '#/case/:caseType/:id',
    '#/case/:id',
    '#/team-cases',
    '#/my-cases',
    '#/journey-cases',
    '#/roadmap',
    '#/my-team',
  ]);
});

test('route table: a route failing to register does not stop the others', () => {
  const originalError = console.error;
  /** @type {any[][]} */
  const logged = [];
  console.error = (/** @type {any[]} */ ...args) => logged.push(args);
  /** @type {string[]} */
  const registered = [];
  try {
    registerRoutes(
      /** @type {any} */ ({
        register(/** @type {string} */ pattern) {
          if (pattern === '#/dashboard') throw new Error('boom');
          registered.push(pattern);
        },
      }),
      makeContext()
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(logged.length, 1, 'the failure should be logged once');
  assert.match(String(logged[0][0]), /route registration failed: dashboard/);
  assert.ok(registered.includes('#/'), 'earlier routes still registered');
  assert.ok(registered.includes('#/my-team'), 'later routes still registered');
});

test('route table: every page module resolves and exposes createRouteSlice', async () => {
  for (const [name, entry] of Object.entries(routeTable(makeContext()))) {
    const module = await entry.load();
    assert.equal(
      typeof module.createRouteSlice,
      'function',
      `${name} must export createRouteSlice`
    );
  }
});

test('route table: the question bank page loader is overridable by the host', async () => {
  const swapped = { createRouteSlice: () => {} };
  const table = routeTable(
    /** @type {any} */ ({
      ...makeContext(),
      loadQuestionBankEditor: async () => swapped,
    })
  );

  assert.equal(await table['question-bank'].load(), swapped);
});

test('journey cases guard: admits a user who owns a Journey Case Type', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(makeContext(['complaints']))['journey-cases'];

  assert.equal(guard?.(), true);
  assert.deepEqual(replacedUrls, [], 'an eligible user is not bounced');
});

test('journey cases guard: bounces a non-Journey-Owner without loading the page', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(makeContext([]))['journey-cases'];

  assert.equal(guard?.(), false, 'a false guard skips the mount, so no import');
  // The bounce replaces the history entry rather than pushing one, so Back does
  // not return the ineligible user to the route that just bounced them.
  assert.deepEqual(replacedUrls, ['/SitePages/app.aspx#/']);
  assert.equal(location.hash, '', 'does not push a history entry');
});

test('journey cases guard: no other route gates its mount', () => {
  const gated = Object.entries(routeTable(makeContext()))
    .filter(([, entry]) => entry.guard)
    .map(([name]) => name);

  assert.deepEqual(gated, ['journey-cases']);
});
