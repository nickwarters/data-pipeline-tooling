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
import { register } from '../src/routes/roadmap.js';

function context() {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/roadmap' },
      currentUser: { id: 'u1', displayName: 'User' },
      permissions: {},
    },
    appEl: { classList: { add() {}, remove() {} } },
  });
}

test('roadmap route registers #/roadmap', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), context());
  assert.equal(registration.has('#/roadmap'), true);
});

test('roadmap route mounts and disposes the store-driven slice', async () => {
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
            heading.textContent = 'Roadmap';
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
  const handler = registration.handlerFor('#/roadmap');
  await handler.mount(container, {});
  assert.equal(container.querySelector('h1')?.textContent, 'Roadmap');
  handler.unmount();
  assert.equal(disposed, true);
});

test('roadmap route load failure stays inside the router boundary', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const router = new Router();
    const container = document.createElement('main');
    initRouter(router, container);
    register(router, context(), () => Promise.reject(new Error('boom')));
    await router.navigate('#/roadmap');
    assert.equal(
      container.querySelector('.cora-route-error')?.className,
      'cora-route-error'
    );
  } finally {
    console.error = originalError;
  }
});
