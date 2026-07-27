// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './_dom-stub.js';
import { initRouter, routeRegistrationSpy } from './helpers/router.js';

installDom();

/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};
/** @type {any} */ (globalThis).location = { hash: '', search: '' };

const { Router } = await import('../src/lib/router.js');
const { register } = await import('../src/routes/case.js');

/**
 * A client that records the id/opts each getCase is called with. Returning null
 * short-circuits the loader load after the fetch, which is all these route
 * tests need: they verify the route plumbs its params into the store module.
 * @param {Array<{ id: string, opts: any }>} calls
 */
function makeClient(calls) {
  return {
    async getCase(/** @type {string} */ id, /** @type {any} */ opts) {
      calls.push({ id, opts });
      return null;
    },
    async getCurrentUser() {
      return { id: 'u7', displayName: 'User 7' };
    },
    async getExportHash() {
      return null;
    },
    async resolveUsers() {
      return {};
    },
  };
}

/** @param {Array<{ id: string, opts: any }>} [calls] */
function makeContext(calls = []) {
  const currentUser = { id: 'u7', displayName: 'User 7' };
  const capabilities = { isReviewer: true, ownedCaseTypes: [] };
  return /** @type {any} */ ({
    client: makeClient(calls),
    saveQueue: {
      status: { get: () => 'saved' },
      subscribeStatus(
        /** @type {(status: 'saved'|'saving'|'reconnecting'|'conflict') => void} */ listener
      ) {
        listener('saved');
        return () => {};
      },
      loadCase() {},
      enqueue() {},
    },
    currentUser,
    capabilities,
    chrome: {
      toasts: [],
      nav: { currentHash: '' },
      currentUser,
      permissions: capabilities,
    },
  });
}

test('case route: register calls router.register with #/case/:id', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), makeContext());
  assert.equal(registration.has('#/case/:id'), true);
});

test('case route: registers source-key case route', () => {
  const registration = routeRegistrationSpy();
  register(/** @type {any} */ (registration.router), makeContext());
  assert.equal(registration.has('#/case/:caseType/:id'), true);
});

test('case route: navigating away runs the case route unmount cleanly', async () => {
  const router = new Router();
  initRouter(router, document.createElement('main'));
  register(router, makeContext());
  let elsewhereMounted = false;
  router.register('#/elsewhere', {
    mount() {
      elsewhereMounted = true;
    },
    unmount() {},
  });

  await router.navigate('#/case/456');
  await flush();
  // Navigating away invokes the case route's (no-op) unmount(); it must run
  // cleanly and let the next route mount.
  await router.navigate('#/elsewhere');

  assert.equal(
    elsewhereMounted,
    true,
    'the next route mounts after case unmounts'
  );
});

test('case route: mount composes the store route and fetches the id from the route', async () => {
  /** @type {Array<{ id: string, opts: any }>} */
  const calls = [];
  const container = document.createElement('main');
  const router = new Router();
  initRouter(router, container);

  register(router, makeContext(calls));
  await router.navigate('#/case/456');
  await flush();

  assert.equal(
    container.childNodes.length,
    1,
    'route mounts a single page host'
  );
  assert.equal(
    /** @type {any} */ (container.childNodes[0]).className,
    'cora-case-review',
    'the host is the Case Review page shell'
  );
  assert.deepEqual(
    calls.map((c) => c.id),
    ['456'],
    'the :id param reaches the loader fetch'
  );
});

test('case route: renders a cora-route-error panel when the page module fails to load', async () => {
  const origConsoleError = console.error;
  console.error = () => {};
  try {
    /** @type {any[]} */
    let mounted = [];
    const router = new Router();
    initRouter(
      router,
      /** @type {any} */ ({
        replaceChildren(/** @type {any} */ ...args) {
          mounted = args;
        },
      })
    );

    register(router, makeContext(), () => Promise.reject(new Error('boom')));
    await router.navigate('#/case/99');

    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
  }
});

test('case route: source-key route passes caseType through to the page', async () => {
  /** @type {Record<string, string> | null} */
  let receivedParams = null;
  const container = document.createElement('main');
  const router = new Router();
  initRouter(router, container);

  register(
    router,
    makeContext(),
    /** @type {any} */ (
      async () => ({
        createRouteSlice(/** @type {Record<string, string>} */ params) {
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
  await router.navigate('#/case/example-review/456');

  assert.equal(
    container.childNodes.length,
    1,
    'route mounts a single page host'
  );
  assert.deepEqual(
    receivedParams,
    { caseType: 'example-review', id: '456', queryString: '' },
    'the source-key and id params reach the store-driven slice'
  );
});
