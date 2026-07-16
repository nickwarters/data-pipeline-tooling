// @ts-check
import './_register-example-review.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './_dom-stub.js';

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
 * short-circuits the view-model load after the fetch, which is all these route
 * tests need: they verify the route plumbs its params into CaseReviewPage.
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

async function settleRouteLoad() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
  }
}

/** @param {Array<{ id: string, opts: any }>} [calls] */
function makeContext(calls = []) {
  return /** @type {any} */ ({
    client: makeClient(calls),
    saveQueue: { loadCase() {} },
    currentUser: { id: 'u7' },
    capabilities: { isReviewer: true, ownedCaseTypes: [] },
  });
}

test('case route: register calls router.register with #/case/:id', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/case/99')),
    '#/case/:id should be registered'
  );
});

test('case route: registers source-key case route', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(router, makeContext());
  assert.ok(
    router._routes.some((r) => r.re.test('#/case/example-review/99')),
    '#/case/:caseType/:id should be registered'
  );
});

test('case route: navigating away runs the case route unmount cleanly', async () => {
  const router = new Router();
  router._container = /** @type {any} */ ({ replaceChildren() {} });
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

test('case route: mount composes CaseReviewPage and fetches the id from the route', async () => {
  /** @type {Array<{ id: string, opts: any }>} */
  const calls = [];
  /** @type {any[]} */
  let mounted = [];
  const router = new Router();
  router._container = /** @type {any} */ ({
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  });

  register(router, makeContext(calls));
  await router.navigate('#/case/456');
  await flush();

  assert.equal(mounted.length, 1, 'route mounts a single page host');
  assert.equal(
    mounted[0].className,
    'cora-case-review',
    'the host is the Case Review page shell'
  );
  assert.deepEqual(
    calls.map((c) => c.id),
    ['456'],
    'the :id param reaches the view-model fetch'
  );
});

test('case route: renders a cora-route-error panel when the page module fails to load', async () => {
  const origConsoleError = console.error;
  console.error = () => {};
  try {
    /** @type {any[]} */
    let mounted = [];
    const router = new Router();
    router._container = /** @type {any} */ ({
      replaceChildren(/** @type {any} */ ...args) {
        mounted = args;
      },
    });

    register(router, makeContext(), () => Promise.reject(new Error('boom')));
    await router.navigate('#/case/99');

    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
  }
});

test('case route: source-key route passes caseType through to the page', async () => {
  /** @type {Array<{ id: string, opts: any }>} */
  const calls = [];
  /** @type {any[]} */
  let mounted = [];
  const router = new Router();
  router._container = /** @type {any} */ ({
    replaceChildren(/** @type {any} */ ...args) {
      mounted = args;
    },
  });

  register(router, makeContext(calls));
  router.navigate('#/case/example-review/456');
  // The source-key route resolves the Case Type config via dynamic import()
  // before fetching; the module also reads the bank artifact.
  await settleRouteLoad();

  assert.equal(mounted.length, 1, 'route mounts a single page host');
  assert.equal(mounted[0].className, 'cora-case-review');
  // The example-review Case Type config loads and its listName (none) yields an
  // empty options object; the :id still reaches the fetch through the page.
  assert.deepEqual(
    calls.map((c) => c.id),
    ['456'],
    'the :id param reaches the view-model fetch on the source-key route'
  );
});
