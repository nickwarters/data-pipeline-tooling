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
import { register } from '../src/routes/my-cases.js';

function context() {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/my-cases' },
      currentUser: { id: 'rp-1', displayName: 'RP' },
      permissions: {},
    },
    caseSources: [],
  });
}

test('Responsible Party route registers the unchanged URL', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), context());
  assert.equal(registration.has('#/my-cases'), true);
});

test('Responsible Party route mounts and disposes the store-driven slice', async () => {
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
  const container = document.createElement('main');
  const handler = registration.handlerFor('#/my-cases');
  await handler.mount(container, {});
  assert.equal(container.querySelector('section')?.tagName, 'SECTION');
  assert.equal(/** @type {any} */ (container)._children.length, 1);
  handler.unmount();
  assert.equal(disposed, true);
});

test('Responsible Party route load failure stays inside the router boundary', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const router = new Router();
    const container = document.createElement('main');
    initRouter(router, container);
    register(router, context(), () => Promise.reject(new Error('boom')));
    await router.navigate('#/my-cases');
    assert.equal(
      container.querySelector('.cora-route-error')?.className,
      'cora-route-error'
    );
  } finally {
    console.error = originalError;
  }
});
