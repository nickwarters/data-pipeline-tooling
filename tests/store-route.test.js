// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { initRouter } from './helpers/router.js';

installDom();

const { createStoreRoute } = await import('../src/core/store-route.js');
const { Router } = await import('../src/lib/router.js');

test('store route: mounts a rendered slice and disposes its store, memo cache, and listeners', async () => {
  const container = document.createElement('div');
  let listenerDisposed = false;
  let renders = 0;
  let memoSizeAtDispose = -1;
  let memoAfterMount = /** @type {any} */ (null);
  let dispatchAfterMount = /** @type {any} */ (null);

  const handler = createStoreRoute({
    load: async () => ({
      createRouteSlice: () => ({
        initialState: { count: 0 },
        reducer: (state, action) =>
          action.type === 'increment' ? { count: state.count + 1 } : state,
        view: (state, { memo }) => {
          renders += 1;
          return memo('count', [state.count], () => {
            const el = document.createElement('p');
            el.textContent = String(state.count);
            return el;
          });
        },
        setup: ({ dispatch, memo }) => {
          memoAfterMount = memo;
          dispatchAfterMount = dispatch;
          dispatch({ type: 'increment' });
          return () => {
            listenerDisposed = true;
            memoSizeAtDispose = memo.size;
          };
        },
      }),
    }),
    context: /** @type {any} */ ({}),
  });

  await handler.mount(container, {});
  await Promise.resolve();

  assert.equal(renders, 2, 'initial render plus the setup dispatch');
  assert.equal(container.textContent, '1');

  handler.unmount();
  assert.equal(listenerDisposed, true, 'slice listener cleanup ran');
  assert.equal(memoSizeAtDispose, 1, 'cleanup runs before memo eviction');
  assert.equal(memoAfterMount.size, 0, 'memo cache is empty after unmount');
  dispatchAfterMount({ type: 'increment' });
  await Promise.resolve();
  assert.equal(renders, 2, 'disposed store schedules no later renders');
});

test('store route: unmount during a lazy load discards the stale slice before setup', async () => {
  let release = /** @type {(value: any) => void} */ (() => {});
  const loading = new Promise((resolve) => {
    release = resolve;
  });
  let slicesCreated = 0;
  let listenersCreated = 0;
  const container = document.createElement('div');
  const handler = createStoreRoute({
    load: () => loading,
    context: /** @type {any} */ ({}),
  });

  const mounting = handler.mount(container, {});
  handler.unmount();
  release({
    createRouteSlice: () => {
      slicesCreated += 1;
      return {
        initialState: {},
        reducer: (/** @type {any} */ state) => state,
        view: () => document.createElement('p'),
        setup: () => {
          listenersCreated += 1;
        },
      };
    },
  });
  await mounting;

  assert.equal(
    slicesCreated,
    0,
    'stale navigation never creates a state slice'
  );
  assert.equal(
    listenersCreated,
    0,
    'stale navigation never attaches listeners'
  );
  assert.equal(container.childNodes.length, 0);
});

test('store route: a broken new-style module rejects through the router mount contract', async () => {
  const failure = new Error('broken view module');
  const handler = createStoreRoute({
    load: async () => {
      throw failure;
    },
    context: /** @type {any} */ ({}),
  });

  await assert.rejects(async () => {
    await handler.mount(document.createElement('div'), {});
  }, failure);
});

test('store route: a broken lazy module renders the existing router error panel', async () => {
  const router = new Router();
  const container = document.createElement('div');
  initRouter(router, container);
  const originalError = console.error;
  console.error = () => {};
  try {
    router.register(
      '#/broken-store-view',
      createStoreRoute({
        load: async () => {
          throw new Error('broken store view');
        },
        context: {},
      })
    );

    await router.navigate('#/broken-store-view');

    assert.equal(container.childNodes.length, 1);
    assert.equal(
      /** @type {any} */ (container.childNodes[0]).className,
      'cora-route-error'
    );
  } finally {
    console.error = originalError;
  }
});

test('store route: stale lazy mount is discarded when a legacy route wins navigation', async () => {
  const router = new Router();
  const container = document.createElement('div');
  initRouter(router, container);
  let release = /** @type {(value: any) => void} */ (() => {});
  const loading = new Promise((resolve) => {
    release = resolve;
  });
  let slicesCreated = 0;

  router.register(
    '#/slow-store-view',
    createStoreRoute({ load: () => loading, context: {} })
  );
  router.register('#/legacy-view', {
    mount(el) {
      const legacy = document.createElement('p');
      legacy.textContent = 'Legacy route';
      el.replaceChildren(legacy);
    },
    unmount() {},
  });

  const slowNavigation = router.navigate('#/slow-store-view');
  await router.navigate('#/legacy-view');
  release({
    createRouteSlice: () => {
      slicesCreated += 1;
      return {
        initialState: {},
        reducer: (/** @type {any} */ state) => state,
        view: () => document.createElement('section'),
      };
    },
  });
  await slowNavigation;

  assert.equal(slicesCreated, 0);
  assert.equal(container.textContent, 'Legacy route');
});
