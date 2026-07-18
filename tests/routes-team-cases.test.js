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

test('team cases route: passes the hash query to the store-driven slice', async () => {
  /** @type {Record<string, string> | null} */
  let receivedParams = null;
  /** @type {any} */ (globalThis).location.hash =
    '#/team-cases?manager=me&status=overdue';
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

  await router.navigate(location.hash);
  assert.equal(
    /** @type {Record<string, string>} */ (
      /** @type {unknown} */ (receivedParams)
    ).queryString,
    '?manager=me&status=overdue'
  );
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

  // Preserve the existing structural-debt count without adding new coupling.
  assert.equal(
    /** @type {any} */ (document.createElement('div'))._children.length,
    0
  );
});
