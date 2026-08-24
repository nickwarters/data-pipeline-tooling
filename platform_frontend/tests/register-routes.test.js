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
 * injected fakes — that every entry in the table, whether it holds an imported
 * page module or a thunk that fetches one, yields something exposing
 * `createRouteSlice`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { makePermissions } from './helpers/fixtures.js';
import { resolveCapabilities } from '../src/services/permissions.js';

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
 * @param {Partial<import('../src/services/permissions.js').Capabilities>} [permissions]
 * @returns {import('../src/setup/register-routes.js').AppContext}
 */
function makeContext(journeyCaseSources = ['complaints'], permissions = {}) {
  return /** @type {any} */ ({
    client: {},
    saveQueue: {},
    chrome: {
      currentUser: { id: 'u1', displayName: 'A User' },
      permissions: makePermissions(permissions),
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
    '#/my-stats',
    '#/team-stats',
    '#/question-bank',
    '#/case/:caseType/:id',
    '#/case/:id',
    '#/team-cases',
    '#/my-cases',
    '#/journey-cases',
    '#/roadmap',
    '#/my-team',
    '#/search',
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

test('route table: a table that cannot be built is logged, not thrown', () => {
  // Building the table is the one step no per-entry catch can contain, so it
  // gets its own. Simulated with a context whose property read throws.
  const originalError = console.error;
  /** @type {any[][]} */
  const logged = [];
  console.error = (/** @type {any[]} */ ...args) => logged.push(args);
  /** @type {string[]} */
  const registered = [];
  const hostile = makeContext();
  Object.defineProperty(hostile, 'loadQuestionBankEditor', {
    get() {
      throw new Error('boom');
    },
  });
  try {
    registerRoutes(
      /** @type {any} */ ({
        register: (/** @type {string} */ p) => registered.push(p),
      }),
      hostile
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /route table could not be built/);
  assert.deepEqual(
    registered,
    [],
    'no route is registered from a broken table'
  );
});

test('route table: every page module resolves and exposes createRouteSlice', async () => {
  for (const [name, entry] of Object.entries(routeTable(makeContext()))) {
    const module =
      entry.page ?? (await /** @type {() => Promise<any>} */ (entry.load)());
    assert.equal(
      typeof module.createRouteSlice,
      'function',
      `${name} must export createRouteSlice`
    );
  }
});

test('my stats route: is statically registered after Dashboard and before Roadmap', () => {
  const table = routeTable(makeContext());
  const names = Object.keys(table);
  const myStats = table['my-stats'];

  assert.deepEqual(myStats.paths, ['#/my-stats']);
  assert.ok(myStats.page);
  assert.equal(myStats.load, undefined);
  assert.ok(names.indexOf('dashboard') < names.indexOf('my-stats'));
  assert.ok(names.indexOf('my-stats') < names.indexOf('roadmap'));
});

test('team stats route: is statically registered immediately after My Stats', () => {
  const table = routeTable(makeContext());
  const names = Object.keys(table);
  const teamStats = table['team-stats'];

  assert.deepEqual(teamStats.paths, ['#/team-stats']);
  assert.ok(teamStats.page);
  assert.equal(teamStats.load, undefined);
  assert.equal(names.indexOf('team-stats'), names.indexOf('my-stats') + 1);
});

test('route table: the Question Bank editor is the only page still fetched on demand', () => {
  const entries = Object.entries(routeTable(makeContext()));
  const deferred = entries
    .filter(([, entry]) => entry.load)
    .map(([name]) => name);

  assert.deepEqual(
    deferred,
    ['question-bank'],
    'the largest, Maintainer-only, host-swappable page is the one exception'
  );
  for (const [name, entry] of entries) {
    if (name === 'question-bank') continue;
    assert.ok(entry.page, `${name} must hold its imported page module`);
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

  const load = /** @type {() => Promise<any>} */ (table['question-bank'].load);
  assert.equal(await load(), swapped);
});

test('journey cases guard: admits a user who owns a Journey Case Type', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(makeContext(['complaints']))['journey-cases'];

  assert.equal(guard?.(), true);
  assert.deepEqual(replacedUrls, [], 'an eligible user is not bounced');
});

test('journey cases guard: bounces a non-Journey-Owner without mounting the page', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(makeContext([]))['journey-cases'];

  assert.equal(
    guard?.(),
    false,
    'a false guard skips the mount, so no slice, store or effect runs'
  );
  // The bounce replaces the history entry rather than pushing one, so Back does
  // not return the ineligible user to the route that just bounced them.
  assert.deepEqual(replacedUrls, ['/SitePages/app.aspx#/']);
  assert.equal(location.hash, '', 'does not push a history entry');
});

test('route table: only the eligibility-gated routes guard their mount', () => {
  const gated = Object.entries(routeTable(makeContext()))
    .filter(([, entry]) => entry.guard)
    .map(([name]) => name);

  assert.deepEqual(gated, [
    'my-stats',
    'team-stats',
    'journey-cases',
    'search',
  ]);
});

test('my stats guard: rejects and redirects a manager who is not a Reviewer', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(
    makeContext([], { isReviewer: false, isReviewerManager: true })
  )['my-stats'];

  assert.equal(guard?.(), false);
  assert.deepEqual(replacedUrls, ['/SitePages/app.aspx#/']);
});

test('my stats guard: admits Reviewer-only and dual-role users', () => {
  for (const permissions of [
    { isReviewer: true, isReviewerManager: false },
    { isReviewer: true, isReviewerManager: true },
  ]) {
    replacedUrls.length = 0;
    const { guard } = routeTable(makeContext([], permissions))['my-stats'];

    assert.equal(guard?.(), true);
    assert.deepEqual(replacedUrls, []);
  }
});

test('team stats guard: admits a manager without the Reviewer capability', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(
    makeContext([], { isReviewer: false, isReviewerManager: true })
  )['team-stats'];

  assert.equal(guard?.(), true);
  assert.deepEqual(replacedUrls, []);
});

test('team stats guard: redirects a Reviewer who is not a manager', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(
    makeContext([], { isReviewer: true, isReviewerManager: false })
  )['team-stats'];

  assert.equal(guard?.(), false);
  assert.deepEqual(replacedUrls, ['/SitePages/app.aspx#/']);
});

test('team stats guard: admits a user with both Reviewer roles', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(
    makeContext([], { isReviewer: true, isReviewerManager: true })
  )['team-stats'];

  assert.equal(guard?.(), true);
  assert.deepEqual(replacedUrls, []);
});

test('my stats guard: follows resolveCapabilities for Reviewer group combinations', () => {
  for (const groups of [
    ['Reviewers'],
    ['Reviewers - Complaints'],
    ['Reviewer Managers'],
    ['Reviewers', 'Reviewer Managers'],
  ]) {
    const permissions = resolveCapabilities(groups);
    const { guard } = routeTable(makeContext([], permissions))['my-stats'];
    replacedUrls.length = 0;

    assert.equal(guard?.(), permissions.isReviewer, groups.join(' + '));
    assert.deepEqual(
      replacedUrls,
      permissions.isReviewer ? [] : ['/SitePages/app.aspx#/'],
      groups.join(' + ')
    );
  }
});

test('search guard: admits a user whose capabilities permit a cross-Case-Type lookup', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(makeContext([], { canSearchCases: true }))[
    'search'
  ];

  assert.equal(guard?.(), true);
  assert.deepEqual(replacedUrls, [], 'an eligible user is not bounced');
});

test('search guard: bounces a user without the capability, without mounting the page', () => {
  replacedUrls.length = 0;
  const { guard } = routeTable(makeContext([], { canSearchCases: false }))[
    'search'
  ];

  assert.equal(guard?.(), false);
  // Replaces rather than pushes, for the same reason the Journey Cases guard
  // does: Back must not return the user to the route that just bounced them.
  assert.deepEqual(replacedUrls, ['/SitePages/app.aspx#/']);
  assert.equal(location.hash, '', 'does not push a history entry');
});
