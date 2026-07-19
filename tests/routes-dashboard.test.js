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

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/dashboard.js';

function context() {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/dashboard' },
      currentUser: { id: 'u1', displayName: 'User' },
      permissions: {},
    },
    caseSources: [],
    allocationSources: [],
    appEl: document.createElement('main'),
  });
}

test('dashboard route registers the unchanged URL', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), context());
  assert.equal(registration.has('#/dashboard'), true);
});

test('dashboard route mounts and disposes the store-driven slice', async () => {
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
          view: () => {
            const heading = document.createElement('h1');
            heading.textContent = 'Dashboard';
            return heading;
          },
          start: () => () => {
            disposed = true;
          },
        }),
      })
    )
  );
  const container = document.createElement('main');
  const handler = registration.handlerFor('#/dashboard');
  await handler.mount(container, {});
  assert.equal(container.querySelector('h1')?.textContent, 'Dashboard');
  assert.equal(/** @type {any} */ (container)._children.length, 1);
  handler.unmount();
  assert.equal(disposed, true);
});

test('dashboard route load failure stays inside the router boundary', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const router = new Router();
    const container = document.createElement('main');
    initRouter(router, container);
    register(router, context(), () => Promise.reject(new Error('boom')));
    await router.navigate('#/dashboard');
    assert.equal(
      container.querySelector('.cora-route-error')?.className,
      'cora-route-error'
    );
  } finally {
    console.error = originalError;
  }
});
