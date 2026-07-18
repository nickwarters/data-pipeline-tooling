// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { initRouter, routeRegistrationSpy } from './helpers/router.js';
import { installDom } from './_dom-stub.js';

isolateBrowserGlobals();
installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/root.js';

function capabilities() {
  return {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: true,
  };
}

function context() {
  const permissions = capabilities();
  return /** @type {any} */ ({
    chrome: {
      toasts: [],
      nav: { currentHash: '#/' },
      currentUser: { id: 'u1', displayName: 'A User' },
      permissions,
    },
    capabilities: permissions,
    caseSources: [],
    journeyCaseSources: [],
  });
}

test('root route: registers #/ through the store-route adapter', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), context());

  assert.equal(registration.has('#/'), true);
});

test('root route: mounts Home at #/ inside the router container', async () => {
  const router = new Router();
  const container = document.createElement('main');
  initRouter(router, container);
  register(router, context());

  await router.navigate('#/');

  assert.equal(container.childNodes.length, 1);
  assert.equal(container.querySelector('h2')?.textContent, 'Visitor');
  assert.equal(container.querySelector('a'), null);
});

test('root route: rejecting the Home module renders the route error panel', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const router = new Router();
    const container = document.createElement('main');
    initRouter(router, container);
    register(router, context(), () => Promise.reject(new Error('boom')));

    await router.navigate('#/');

    assert.equal(
      /** @type {HTMLElement} */ (container.childNodes[0]).className,
      'cora-route-error'
    );
  } finally {
    console.error = originalError;
  }
});

test('root route: unmount disposes the store-driven Home slice', async () => {
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

  const handler = registration.handlerFor('#/');
  await handler.mount(document.createElement('main'), {});
  handler.unmount();

  assert.equal(disposed, true);
});
