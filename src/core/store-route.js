// @ts-check
import { morph } from './morph.js';
import { createMemo } from './memo.js';
import { createStore } from './store.js';
import { createRouteErrorPanel } from '../lib/route-error-panel.js';

/**
 * Adapt a lazy store-driven view module to the existing Router handler shape.
 * The adapter owns the route-local store, memo cache, and listener cleanup.
 *
 * @template Context
 * @param {{
 *   load: () => Promise<{ createRouteSlice: (params: Record<string, string>, context: Context) => {
 *     initialState: any,
 *     reducer: (state: any, action: any) => any,
 *     view?: (state: any, tools: { dispatch: (action: any) => any, memo: any, params: Record<string, string>, context: Context }) => any,
 *     render?: (container: Element, state: any, tools: { dispatch: (action: any) => any, memo: any, morph: typeof morph, params: Record<string, string>, context: Context }) => void,
 *     start?: (tools: { dispatch: (action: any) => any, memo: any, params: Record<string, string>, context: Context, isActive: () => boolean, signal: AbortSignal, listen: (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void }) => void | (() => void),
 *   } }>,
 *   context: Context,
 * }} options
 * @returns {import('../lib/router.js').RouteHandler}
 */
export function createStoreRoute({ load, context }) {
  let mountSequence = 0;
  /** @type {null | (() => void)} */
  let disposeMountedSlice = null;

  return {
    async mount(container, params) {
      const token = ++mountSequence;
      const module = await load();

      // Router.unmount() may run while the lazy import is pending. Do not let a
      // stale module create a store or attach listeners after navigation.
      if (token !== mountSequence) return;

      const slice = module.createRouteSlice(params, context);
      const memo = createMemo();
      /** @type {Array<() => void>} */
      const removeListeners = [];
      /** @type {ReturnType<typeof createStore<any, any>>} */
      let store;
      // Set once the initial synchronous render has succeeded. Before that, a
      // render failure propagates to mount()'s catch, which disposes and
      // rethrows so the router's ADR-0002 containment handles it. After it,
      // renders run coalesced on a microtask with no other try/catch on the
      // path, so this callback must contain failures itself.
      let mounted = false;
      // The mount lifetime, owned here and exposed to the slice. A route effect
      // guards a late `.then()` with isActive() instead of hand-rolling its own
      // latch; the signal is the same lifetime in AbortSignal form (#517).
      const controller = new AbortController();
      const tools = {
        dispatch: (/** @type {any} */ action) => store.dispatch(action),
        memo,
        morph,
        params,
        context,
        /** True until this slice is unmounted. */
        isActive: () => !controller.signal.aborted,
        /** Aborted when this slice unmounts. */
        signal: controller.signal,
        listen(
          /** @type {EventTarget} */ target,
          /** @type {string} */ type,
          /** @type {EventListenerOrEventListenerObject} */ listener,
          /** @type {boolean | AddEventListenerOptions | undefined} */ options
        ) {
          target.addEventListener(type, listener, options);
          removeListeners.push(() =>
            target.removeEventListener(type, listener, options)
          );
        },
      };
      store = createStore({
        initialState: slice.initialState,
        reducer: slice.reducer,
        render: (state) => {
          try {
            if (slice.render) {
              slice.render(container, state, tools);
              return;
            }
            if (!slice.view) {
              throw new TypeError(
                'Store route slice must define view() or render()'
              );
            }
            morph(container, slice.view(state, tools));
          } catch (error) {
            if (!mounted) throw error;
            console.error('[CORA] route render failed after mount', error);
            disposeMountedSlice?.();
            disposeMountedSlice = null;
            container.replaceChildren(createRouteErrorPanel());
          }
        },
      });

      /** @type {void | (() => void)} */
      let disposeListeners;
      disposeMountedSlice = () => {
        for (const removeListener of removeListeners.splice(0)) {
          removeListener();
        }
        if (typeof disposeListeners === 'function') disposeListeners();
        controller.abort();
        store.dispose();
        memo.clear();
      };
      try {
        store.render();
        mounted = true;
        disposeListeners = slice.start?.(tools);
      } catch (error) {
        disposeMountedSlice();
        disposeMountedSlice = null;
        throw error;
      }
    },

    unmount() {
      mountSequence += 1;
      disposeMountedSlice?.();
      disposeMountedSlice = null;
    },
  };
}

/**
 * Register one lazily-loaded store-driven page on one or more hash patterns.
 *
 * Without a guard the adapter is registered directly, so nothing sits between
 * the router and `createStoreRoute`.
 *
 * `load` is the caller's: the dynamic `import()` of a page must stay inside
 * `src/routes/*`, which is what ADR-0002's page independence and
 * `tests/component-layering-contract.test.js` rest on. This helper never names
 * a page.
 *
 * `guard` runs on every mount, before the page is loaded. Returning false skips
 * the mount entirely — the shape an eligibility bounce needs, so the ineligible
 * user never pays for the page module.
 *
 * @template Context
 * @param {import('../lib/router.js').Router} router
 * @param {{
 *   paths: string[],
 *   load: Parameters<typeof createStoreRoute<Context>>[0]['load'],
 *   context: Context,
 *   guard?: () => boolean,
 * }} options
 * @returns {void}
 */
export function registerStoreRoute(router, { paths, load, context, guard }) {
  const handler = createStoreRoute({ load, context });
  const registered = guard
    ? {
        /** @type {import('../lib/router.js').RouteHandler['mount']} */
        mount(container, params) {
          if (!guard()) return;
          return handler.mount(container, params);
        },
        unmount() {
          handler.unmount();
        },
      }
    : handler;

  for (const path of paths) router.register(path, registered);
}
