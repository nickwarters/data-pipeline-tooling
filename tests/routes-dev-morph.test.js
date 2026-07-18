// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { routeRegistrationSpy } from './helpers/router.js';

isolateBrowserGlobals();
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
  let mountedInto = null;
  register(/** @type {any} */ (registration.router), /** @type {any} */ ({}), {
    isDev: () => true,
    load: async () => ({
      mountDevMorphHarness: (/** @type {any} */ c) => {
        mountedInto = c;
        return () => {};
      },
      // Unused exports, present so the module shape matches.
      visibleItems: () => [],
      harnessView: () => /** @type {any} */ ({}),
    }),
  });
  const container = { id: 'container' };
  await registration.handlerFor('#/dev/morph').mount(container);
  assert.equal(mountedInto, container);
});

test('dev-morph route: unmount is a no-op (does not throw)', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), /** @type {any} */ ({}), {
    isDev: () => true,
  });
  assert.doesNotThrow(() => registration.handlerFor('#/dev/morph').unmount());
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
