// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { initRouter } from './helpers/router.js';

installDom();

const { createStoreRoute } = await import('../src/core/store-route.js');
const { Router } = await import('../src/lib/router.js');

test('store route: navigation removes real listeners and disposes store renders and memo entries', async () => {
  const container = document.createElement('div');
  const events = new EventTarget();
  let eventCount = 0;
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
        start: ({ dispatch, memo, listen }) => {
          memoAfterMount = memo;
          dispatchAfterMount = dispatch;
          listen(events, 'route-event', () => {
            eventCount += 1;
            dispatch({ type: 'increment' });
          });
          dispatch({ type: 'increment' });
          return () => {
            memoSizeAtDispose = memo.size;
          };
        },
      }),
    }),
    context: /** @type {any} */ ({}),
  });

  await handler.mount(container, {});
  await Promise.resolve();

  assert.equal(renders, 2, 'initial render plus the route-effect dispatch');
  assert.equal(container.textContent, '1');
  events.dispatchEvent(new Event('route-event'));
  await Promise.resolve();
  assert.equal(eventCount, 1);
  assert.equal(renders, 3);

  handler.unmount();
  assert.equal(memoSizeAtDispose, 1, 'cleanup runs before memo eviction');
  assert.equal(memoAfterMount.size, 0, 'memo cache is empty after unmount');
  events.dispatchEvent(new Event('route-event'));
  await Promise.resolve();
  assert.equal(eventCount, 1, 'the route listener was removed on navigation');
  dispatchAfterMount({ type: 'increment' });
  await Promise.resolve();
  assert.equal(renders, 3, 'disposed store schedules no later renders');
});

test('store route: a slice renderer can morph only the containers selected by state', async () => {
  const container = document.createElement('div');
  /** @type {string[][]} */
  const renderedGroups = [];
  let dispatch = /** @type {any} */ (null);
  const handler = createStoreRoute({
    load: async () => ({
      createRouteSlice: () => ({
        initialState: { dirtyGroups: ['group-1', 'group-2'] },
        reducer: (_state, action) => ({ dirtyGroups: action.dirtyGroups }),
        render: (_container, state, tools) => {
          renderedGroups.push([...state.dirtyGroups]);
          dispatch = tools.dispatch;
        },
      }),
    }),
    context: {},
  });

  await handler.mount(container, {});
  dispatch({ dirtyGroups: ['group-2'] });
  await Promise.resolve();

  assert.deepEqual(renderedGroups, [['group-1', 'group-2'], ['group-2']]);
});

test('store route: unmount during a lazy load discards the stale slice before its effect starts', async () => {
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
        start: () => {
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
