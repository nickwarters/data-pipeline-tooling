// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { initRouter, routeRegistrationSpy } from './helpers/router.js';

installDom();

const { createStoreRoute, registerStoreRoute } =
  await import('../src/core/store-route.js');
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

test('store route: the mount lifetime is exposed so a late promise dispatches nothing', async () => {
  const container = document.createElement('div');
  let release = /** @type {(value: any) => void} */ (() => {});
  const loading = new Promise((resolve) => {
    release = resolve;
  });
  let tools = /** @type {any} */ (null);
  let reduced = 0;
  const handler = createStoreRoute({
    load: async () => ({
      createRouteSlice: () => ({
        initialState: { loaded: false },
        reducer: (/** @type {any} */ state) => {
          reduced += 1;
          return { ...state, loaded: true };
        },
        view: () => document.createElement('p'),
        start: (/** @type {any} */ startTools) => {
          tools = startTools;
          void loading.then(() => {
            if (startTools.isActive())
              startTools.dispatch({ type: 'items/loaded' });
          });
        },
      }),
    }),
    context: /** @type {any} */ ({}),
  });

  await handler.mount(container, {});
  assert.equal(tools.isActive(), true, 'the slice is active while mounted');
  assert.equal(tools.signal.aborted, false);

  handler.unmount();
  assert.equal(tools.isActive(), false, 'isActive() flips false on unmount');
  assert.equal(tools.signal.aborted, true, 'the signal aborts on unmount');

  release(undefined);
  await loading;
  await Promise.resolve();
  assert.equal(
    reduced,
    0,
    'a promise resolving after unmount dispatches nothing'
  );
});

test('store route: a slice renderer can render only the containers selected by state', async () => {
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

test('store route: a slice without view() or render() rejects the initial mount and disposes cleanly', async () => {
  let listenerRemoved = false;
  const events = new EventTarget();
  const container = document.createElement('div');
  const handler = createStoreRoute({
    load: async () => ({
      createRouteSlice: () => ({
        initialState: {},
        reducer: (/** @type {any} */ state) => state,
        start: ({ listen }) => {
          listen(events, 'route-event', () => {});
          return () => {
            listenerRemoved = true;
          };
        },
      }),
    }),
    context: /** @type {any} */ ({}),
  });

  await assert.rejects(async () => {
    await handler.mount(container, {});
  }, TypeError);

  // The initial-render failure must be handled by mount()'s own catch (which
  // rethrows for the router to show its panel), not by the post-mount path,
  // so start() never ran and there is nothing to dispose.
  assert.equal(listenerRemoved, false);
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

test('store route: a view that throws on a scheduled render after mount shows the error panel and stops further renders', async () => {
  const container = document.createElement('div');
  let dispatch = /** @type {any} */ (null);
  let renders = 0;
  let cleanupCalls = 0;
  let eventFired = 0;
  const events = new EventTarget();
  const failure = new Error('broken second render');
  const originalError = console.error;
  /** @type {any[]} */
  const errorCalls = [];
  console.error = (...args) => errorCalls.push(args);

  const handler = createStoreRoute({
    load: async () => ({
      createRouteSlice: () => ({
        initialState: { count: 0 },
        reducer: (state, action) =>
          action.type === 'increment' ? { count: state.count + 1 } : state,
        view: (state) => {
          renders += 1;
          if (state.count > 0) throw failure;
          const el = document.createElement('p');
          el.textContent = String(state.count);
          return el;
        },
        start: ({ dispatch: d, listen }) => {
          dispatch = d;
          listen(events, 'route-event', () => {
            eventFired += 1;
          });
          return () => {
            cleanupCalls += 1;
          };
        },
      }),
    }),
    context: /** @type {any} */ ({}),
  });

  try {
    await handler.mount(container, {});
    assert.equal(renders, 1);
    assert.equal(container.textContent, '0');

    dispatch({ type: 'increment' });
    await Promise.resolve();

    assert.equal(renders, 2, 'the throwing render was attempted');
    assert.equal(container.childNodes.length, 1);
    assert.equal(
      /** @type {any} */ (container.childNodes[0]).className,
      'cora-route-error'
    );
    assert.equal(cleanupCalls, 1, 'slice cleanup ran on the render failure');
    assert.ok(
      errorCalls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('[CORA]')
      ),
      'the failure was logged via the [CORA] console.error convention'
    );

    // A direct dispatch call must not schedule any more renders after
    // teardown, and the route-event listener registered via listen() must
    // have been removed as part of that teardown.
    dispatch({ type: 'increment' });
    await Promise.resolve();
    assert.equal(renders, 2, 'no further renders are attempted once disposed');

    events.dispatchEvent(new Event('route-event'));
    assert.equal(eventFired, 0, 'the route listener was removed on failure');
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

/**
 * A page the route table already holds as a module object, rather than as a
 * thunk that fetches one. Everything after the module is in hand is the same
 * code either way; what differs is that there is no fetch to wait on.
 */

test('store route: a resolved page has no stale-mount window to unmount into', async () => {
  const container = document.createElement('div');
  let cleanupCalls = 0;
  const handler = createStoreRoute({
    page: {
      createRouteSlice: () => ({
        initialState: {},
        reducer: (/** @type {any} */ state) => state,
        view: () => document.createElement('p'),
        start: () => () => {
          cleanupCalls += 1;
        },
      }),
    },
    context: /** @type {any} */ ({}),
  });

  // No fetch sits between mount() and its slice, so an unmount issued before
  // the mount promise settles still has a live slice to tear down.
  const mounting = handler.mount(container, {});
  handler.unmount();
  await mounting;

  assert.equal(cleanupCalls, 1, 'the slice created by mount() was disposed');
});

test('store route: a page source is required, and only one of them', () => {
  const page = { createRouteSlice: () => ({}) };
  assert.throws(
    () => createStoreRoute(/** @type {any} */ ({ context: {} })),
    TypeError,
    'neither a resolved page nor a loader is not a route'
  );
  assert.throws(
    () =>
      createStoreRoute(
        /** @type {any} */ ({ page, load: async () => page, context: {} })
      ),
    TypeError,
    'two page sources leave it ambiguous which one mounts'
  );
});

/**
 * registerStoreRoute: the shared registration shell the route modules
 * collapse onto. The page reference stays in the caller — the route table —
 * so `page` or `load` is always injected here, never resolved by this helper.
 */

/** @returns {any} a slice module whose view renders a marked element */
function markerModule(/** @type {string} */ text) {
  return async () => ({
    createRouteSlice: () => ({
      initialState: {},
      reducer: (/** @type {any} */ state) => state,
      view: () => {
        const el = document.createElement('h1');
        el.textContent = text;
        return el;
      },
    }),
  });
}

test('registerStoreRoute: registers one shared handler on every path', () => {
  const registration = routeRegistrationSpy();
  registerStoreRoute(/** @type {any} */ (registration.router), {
    paths: ['#/thing/:type/:id', '#/thing/:id'],
    load: markerModule('Thing'),
    context: {},
  });

  assert.equal(registration.has('#/thing/:type/:id'), true);
  assert.equal(registration.has('#/thing/:id'), true);
  assert.equal(
    registration.handlerFor('#/thing/:type/:id'),
    registration.handlerFor('#/thing/:id'),
    'both patterns share one adapter, so one mount owns the store'
  );
});

test('registerStoreRoute: without a guard the adapter is registered directly', async () => {
  const registration = routeRegistrationSpy();
  registerStoreRoute(/** @type {any} */ (registration.router), {
    paths: ['#/plain'],
    load: markerModule('Plain'),
    context: {},
  });

  const container = document.createElement('main');
  await registration.handlerFor('#/plain').mount(container, {});
  assert.equal(container.querySelector('h1')?.textContent, 'Plain');
});

test('registerStoreRoute: a guard returning false skips mount and never loads the page', async () => {
  const registration = routeRegistrationSpy();
  let loaded = false;
  registerStoreRoute(/** @type {any} */ (registration.router), {
    paths: ['#/guarded'],
    load: /** @type {any} */ (
      async () => {
        loaded = true;
        return {};
      }
    ),
    context: {},
    guard: () => false,
  });

  const container = document.createElement('main');
  await registration.handlerFor('#/guarded').mount(container, {});
  assert.equal(loaded, false);
  assert.equal(container.childNodes.length, 0);
});

test('registerStoreRoute: a guard returning true mounts, and unmount still disposes', async () => {
  const registration = routeRegistrationSpy();
  let disposed = false;
  registerStoreRoute(/** @type {any} */ (registration.router), {
    paths: ['#/guarded-ok'],
    load: /** @type {any} */ (
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
    ),
    context: {},
    guard: () => true,
  });

  const handler = registration.handlerFor('#/guarded-ok');
  const container = document.createElement('main');
  await handler.mount(container, {});
  assert.equal(container.childNodes.length, 1);
  handler.unmount();
  assert.equal(disposed, true);
});

test('registerStoreRoute: the guard runs on every mount, not once at registration', async () => {
  const registration = routeRegistrationSpy();
  let allowed = false;
  let guardCalls = 0;
  registerStoreRoute(/** @type {any} */ (registration.router), {
    paths: ['#/eligibility'],
    load: markerModule('Eligible'),
    context: {},
    guard: () => {
      guardCalls += 1;
      return allowed;
    },
  });
  assert.equal(guardCalls, 0, 'registration does not evaluate the guard');

  const handler = registration.handlerFor('#/eligibility');
  const first = document.createElement('main');
  await handler.mount(first, {});
  assert.equal(first.childNodes.length, 0);

  allowed = true;
  const second = document.createElement('main');
  await handler.mount(second, {});
  assert.equal(second.querySelector('h1')?.textContent, 'Eligible');
  assert.equal(guardCalls, 2);
});

test('store route: unmounting mid-read aborts the request and produces no error UI', async () => {
  const { withAbortSignal } =
    await import('../src/services/abortable-client.js');
  const { ignoreAbortError } = await import('../src/lib/abort.js');
  const container = document.createElement('div');
  /** @type {any[]} */
  const toasts = [];
  /** @type {AbortSignal | null} */
  let readSignal = null;
  let loadedDispatched = false;

  // A request that is still in flight: it settles only when the server answers
  // or the caller aborts — the shape MockSharePointClient and fetch both have,
  // and the only one that can still be pending at unmount.
  const client = /** @type {any} */ ({
    listCases: (/** @type {any} */ _filter, /** @type {any} */ opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
      }),
  });

  const handler = createStoreRoute({
    load: async () => ({
      createRouteSlice: () => ({
        initialState: { cases: null },
        reducer: (state, action) =>
          action.type === 'cases/loaded' ? { cases: action.cases } : state,
        view: () => {
          const el = document.createElement('p');
          el.className = 'cora-loaded';
          return el;
        },
        start: (tools) => {
          const bound = withAbortSignal(
            /** @type {any} */ (client),
            tools.signal
          );
          readSignal = tools.signal;
          void bound
            .listCases({}, { listName: 'L' })
            .then((cases) => {
              loadedDispatched = true;
              if (tools.isActive())
                tools.dispatch({ type: 'cases/loaded', cases });
            })
            .catch(ignoreAbortError);
        },
      }),
    }),
    context: /** @type {any} */ ({ toasts }),
  });

  await handler.mount(container, {});
  handler.unmount();
  for (let i = 0; i < 20; i += 1) await Promise.resolve();

  assert.equal(/** @type {any} */ (readSignal).aborted, true);
  assert.equal(loadedDispatched, false, 'the in-flight read never resolved');
  assert.equal(
    container.querySelector('.cora-route-error'),
    null,
    'an abort is not a route failure'
  );
  assert.deepEqual(toasts, [], 'an abort raises no toast');
});
