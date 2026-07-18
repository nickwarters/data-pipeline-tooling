// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { routeRegistrationSpy } from './helpers/router.js';
import { installDom } from './_dom-stub.js';

isolateBrowserGlobals();
installDom();
/** @type {any} */ (globalThis).location = { hash: '', search: '' };

import { register } from '../src/routes/dev-morph.js';

test('dev-morph route: registers #/dev/morph when the dev loop is active', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), /** @type {any} */ ({}), {
    isDev: () => true,
  });
  assert.equal(registration.has('#/dev/morph'), true);
});

test('dev-morph route: registers nothing when the dev loop is inactive', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), /** @type {any} */ ({}), {
    isDev: () => false,
  });
  assert.equal(registration.has('#/dev/morph'), false);
});

test('dev-morph route: mount loads the harness and mounts it into the container', async () => {
  const registration = routeRegistrationSpy();
  let sliceCreated = false;
  register(/** @type {any} */ (registration.router), /** @type {any} */ ({}), {
    isDev: () => true,
    load: async () => ({
      createRouteSlice: () => {
        sliceCreated = true;
        return {
          initialState: { query: '' },
          reducer: (/** @type {{ query: string }} */ state) => state,
          view: () => document.createElement('section'),
        };
      },
    }),
  });
  const container = document.createElement('div');
  await registration.handlerFor('#/dev/morph').mount(container);
  assert.equal(sliceCreated, true);
  assert.equal(/** @type {any} */ (container.childNodes[0]).tagName, 'SECTION');
});

test('dev-morph route: unmount disposes the mounted new-style slice', async () => {
  const registration = routeRegistrationSpy();
  let disposed = false;
  register(/** @type {any} */ (registration.router), /** @type {any} */ ({}), {
    isDev: () => true,
    load: async () => ({
      createRouteSlice: () => ({
        initialState: { query: '' },
        reducer: (/** @type {{ query: string }} */ state) => state,
        view: () => document.createElement('section'),
        start: () => () => {
          disposed = true;
        },
      }),
    }),
  });
  const handler = registration.handlerFor('#/dev/morph');
  await handler.mount(document.createElement('div'), {});
  handler.unmount();
  assert.equal(disposed, true);
});

test('dev-morph route: the default gate follows the ?mock=1 dev loop', () => {
  const original = /** @type {any} */ (globalThis).location;
  try {
    /** @type {any} */ (globalThis).location = { hash: '', search: '?mock=1' };
    const withMock = routeRegistrationSpy();
    register(/** @type {any} */ (withMock.router), /** @type {any} */ ({}));
    assert.equal(withMock.has('#/dev/morph'), true, 'registers under ?mock=1');

    /** @type {any} */ (globalThis).location = { hash: '', search: '' };
    const withoutMock = routeRegistrationSpy();
    register(/** @type {any} */ (withoutMock.router), /** @type {any} */ ({}));
    assert.equal(
      withoutMock.has('#/dev/morph'),
      false,
      'does not register without ?mock=1'
    );
  } finally {
    /** @type {any} */ (globalThis).location = original;
  }
});
