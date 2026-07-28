// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { installDom } from './_dom-stub.js';
import { initRouter, routeRegistrationSpy } from './helpers/router.js';

isolateBrowserGlobals();
installDom();
/** @type {any} */ (globalThis).window = {
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).location = { hash: '' };

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/team-cases.js';
import { parseTeamCasesParams } from '../src/services/team-cases-params.js';

function context() {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/team-cases' },
      currentUser: { id: 'manager-1', displayName: 'Manager' },
      permissions: {},
    },
    caseSources: [],
  });
}

test('team cases route: registers the unchanged URL', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), context());
  assert.equal(registration.has('#/team-cases'), true);
});

/**
 * Navigate to a Team Cases hash and return the params the slice was created
 * with. The route is a plain `registerStoreRoute` now, so this exercises the
 * router's `params.queryString` all the way into the page's own vocabulary.
 * @param {string} hash
 * @returns {Promise<Record<string, string>>}
 */
async function paramsFor(hash) {
  /** @type {Record<string, string> | null} */
  let receivedParams = null;
  const router = new Router();
  const container = document.createElement('main');
  initRouter(router, container);
  register(
    router,
    context(),
    /** @type {any} */ (
      async () => ({
        createRouteSlice: (/** @type {Record<string, string>} */ params) => {
          receivedParams = params;
          return {
            initialState: {},
            reducer: (/** @type {any} */ state) => state,
            view: () => document.createElement('section'),
          };
        },
      })
    )
  );

  await router.navigate(hash);
  assert.notEqual(receivedParams, null, `slice was never created for ${hash}`);
  return /** @type {Record<string, string>} */ (
    /** @type {unknown} */ (receivedParams)
  );
}

test('team cases route: passes the hash query to the store-driven slice', async () => {
  const params = await paramsFor('#/team-cases?manager=me&status=overdue');
  assert.equal(params.queryString, '?manager=me&status=overdue');
});

test('team cases route: a hash with no query still yields a parseable empty queryString', async () => {
  const params = await paramsFor('#/team-cases');
  assert.equal(params.queryString, '');
  assert.deepEqual(parseTeamCasesParams(params.queryString), {
    manager: null,
    role: null,
    caseType: null,
    status: null,
    completedSince: null,
    completedUntil: null,
  });
});

test('team cases route: every Team Cases URL parses to the same params as before', async () => {
  /** @type {Array<[string, import('../src/services/team-cases-params.js').TeamCasesParams]>} */
  const cases = [
    [
      '#/team-cases?manager=me&role=reviewer-manager&status=overdue',
      {
        manager: 'me',
        role: 'reviewer-manager',
        caseType: null,
        status: 'overdue',
        completedSince: null,
        completedUntil: null,
      },
    ],
    [
      '#/team-cases?manager=me',
      {
        manager: 'me',
        role: null,
        caseType: null,
        status: null,
        completedSince: null,
        completedUntil: null,
      },
    ],
    [
      '#/team-cases?role=responsible-party-manager',
      {
        manager: null,
        role: 'responsible-party-manager',
        caseType: null,
        status: null,
        completedSince: null,
        completedUntil: null,
      },
    ],
    [
      '#/team-cases?caseType=complaints',
      {
        manager: null,
        role: null,
        caseType: 'complaints',
        status: null,
        completedSince: null,
        completedUntil: null,
      },
    ],
    [
      '#/team-cases?status=outstanding',
      {
        manager: null,
        role: null,
        caseType: null,
        status: 'outstanding',
        completedSince: null,
        completedUntil: null,
      },
    ],
    [
      '#/team-cases?status=completed&completedSince=2026-01-01&completedUntil=2026-03-31',
      {
        manager: null,
        role: null,
        caseType: null,
        status: 'completed',
        completedSince: '2026-01-01',
        completedUntil: '2026-03-31',
      },
    ],
    // Unknown values are ignored, not passed through — deliberate behaviour.
    [
      '#/team-cases?manager=someone-else&role=nonsense&status=bogus',
      {
        manager: null,
        role: null,
        caseType: null,
        status: null,
        completedSince: null,
        completedUntil: null,
      },
    ],
  ];

  for (const [hash, expected] of cases) {
    const params = await paramsFor(hash);
    assert.deepEqual(
      parseTeamCasesParams(params.queryString),
      expected,
      `parsed params for ${hash}`
    );
  }
});

test('team cases route: load failure remains contained by the router', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const router = new Router();
    const container = document.createElement('main');
    initRouter(router, container);
    register(router, context(), () => Promise.reject(new Error('boom')));

    await router.navigate('#/team-cases');
    assert.equal(container.childNodes.length, 1);
    assert.equal(
      /** @type {HTMLElement} */ (container.childNodes[0]).className,
      'cora-route-error'
    );
  } finally {
    console.error = originalError;
  }
});

test('team cases route: unmount disposes the store-driven slice', async () => {
  let disposed = false;
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    context(),
    /** @type {any} */ (
      async () => ({
        createRouteSlice: () => ({
          initialState: {},
          reducer: (/** @type {any} */ state) => state,
          view: () => document.createElement('section'),
          start: () => () => {
            disposed = true;
          },
        }),
      })
    )
  );

  const handler = registration.handlerFor('#/team-cases');
  await handler.mount(document.createElement('main'), {});
  handler.unmount();
  assert.equal(disposed, true);
});

test('team cases route: a real hash reaches the real page with the real filters', async () => {
  // The tests above stub `createRouteSlice`, so `parseTeamCasesParams` runs in
  // the test rather than in the page: two half-tests meeting in the middle.
  // This one drives the actual page module, so nothing between the hash and
  // the fetch is simulated — it is the only test that fails if the router, the
  // route, or the page's reading of `params.queryString` breaks.
  /** @type {any} */
  let received = null;
  const page = await import('../src/pages/cora-team-cases.js');
  const router = new Router();
  const container = document.createElement('main');
  initRouter(router, container);
  register(
    router,
    context(),
    /** @type {any} */ (
      async () => ({
        createRouteSlice: (/** @type {any} */ params, /** @type {any} */ ctx) =>
          page.createRouteSlice(params, ctx, {
            fetchCases: async (
              /** @type {any} */ _client,
              /** @type {any} */ parsed
            ) => {
              received = parsed;
              return [];
            },
            resolveColumns: async () => [],
          }),
      })
    )
  );

  await router.navigate(
    '#/team-cases?manager=me&role=reviewer-manager&status=overdue'
  );

  assert.equal(received?.manager, 'me');
  assert.equal(received?.role, 'reviewer-manager');
  assert.equal(received?.status, 'overdue');
});
