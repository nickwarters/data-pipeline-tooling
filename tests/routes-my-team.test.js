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

const { Router } = await import('../src/lib/router.js');
const { register } = await import('../src/routes/my-team.js');

test('my team route registers and mounts #/my-team through the store route', async () => {
  let disposed = false;
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({ chrome: {}, caseSources: [] }),
    /** @type {any} */ (
      async () => ({
        createRouteSlice: () => ({
          initialState: {},
          reducer: (/** @type {any} */ state) => state,
          view: () => {
            const heading = document.createElement('h1');
            heading.textContent = 'My Team';
            return heading;
          },
          start: () => () => {
            disposed = true;
          },
        }),
      })
    )
  );

  assert.equal(registration.has('#/my-team'), true);
  const container = document.createElement('main');
  const handler = registration.handlerFor('#/my-team');
  await handler.mount(container, {});
  assert.equal(container.querySelector('h1')?.textContent, 'My Team');
  handler.unmount();
  assert.equal(disposed, true);
});

test('my team route load failure stays inside the router boundary', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const router = new Router();
    const container = document.createElement('main');
    initRouter(router, container);
    register(router, /** @type {any} */ ({ chrome: {}, caseSources: [] }), () =>
      Promise.reject(new Error('boom'))
    );
    await router.navigate('#/my-team');
    assert.equal(
      container.querySelector('.cora-route-error')?.className,
      'cora-route-error'
    );
  } finally {
    console.error = originalError;
  }
});
