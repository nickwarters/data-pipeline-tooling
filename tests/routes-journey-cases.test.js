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
/** @type {string[]} */
const replacedUrls = [];
/** @type {any} */ (globalThis).location = {
  hash: '',
  pathname: '/SitePages/app.aspx',
  search: '',
  /** @param {string} url */
  replace(url) {
    replacedUrls.push(url);
  },
};

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/journey-cases.js';

/** @param {string[]} journeySlugs */
function context(journeySlugs) {
  return /** @type {any} */ ({
    client: {},
    chrome: {
      toasts: [],
      nav: { currentHash: '#/journey-cases' },
      currentUser: { id: 'journey-owner-1', displayName: 'Journey Owner' },
      permissions: {},
    },
    journeyCaseSources: journeySlugs.map((slug) => ({
      slug,
      listName: `${slug}-list`,
      displayName: slug,
    })),
  });
}

test('journey cases route: registers the unchanged URL', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), context(['complaints']));
  assert.equal(registration.has('#/journey-cases'), true);
});

test('journey cases route: mounts the store-driven slice', async () => {
  const router = new Router();
  const container = document.createElement('main');
  initRouter(router, container);
  register(
    router,
    context(['complaints']),
    /** @type {any} */ (
      async () => ({
        createRouteSlice: () => ({
          initialState: {},
          reducer: (/** @type {any} */ state) => state,
          view: () => {
            const heading = document.createElement('h1');
            heading.textContent = 'Journey Cases';
            return heading;
          },
        }),
      })
    )
  );

  await router.navigate('#/journey-cases');
  assert.equal(container.querySelector('h1')?.textContent, 'Journey Cases');
  assert.equal(/** @type {any} */ (container)._children.length, 1);
});

test('journey cases route: redirects a non-Journey-Owner without loading the page', async () => {
  replacedUrls.length = 0;
  let loaded = false;
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    context([]),
    /** @type {any} */ (
      async () => {
        loaded = true;
        return {};
      }
    )
  );

  await registration
    .handlerFor('#/journey-cases')
    .mount(document.createElement('main'), {});
  // Deliberate behaviour change (#519): the bounce replaces the history entry
  // instead of pushing one, so Back does not return the ineligible user to the
  // route that just bounced them. Where it bounces to is unchanged.
  assert.deepEqual(replacedUrls, ['/SitePages/app.aspx#/']);
  assert.equal(location.hash, '', 'does not push a history entry');
  assert.equal(loaded, false);
});

test('journey cases route: load failure remains contained by the router', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const router = new Router();
    const container = document.createElement('main');
    initRouter(router, container);
    register(router, context(['complaints']), () =>
      Promise.reject(new Error('boom'))
    );

    await router.navigate('#/journey-cases');
    assert.equal(container.childNodes.length, 1);
    assert.equal(
      /** @type {HTMLElement} */ (container.childNodes[0]).className,
      'cora-route-error'
    );
  } finally {
    console.error = originalError;
  }
});

test('journey cases route: unmount disposes the store-driven slice', async () => {
  let disposed = false;
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    context(['complaints']),
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

  const handler = registration.handlerFor('#/journey-cases');
  await handler.mount(document.createElement('main'), {});
  handler.unmount();
  assert.equal(disposed, true);
});
