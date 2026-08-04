// @ts-check
import { render } from './render.js';
import { createMemo } from './memo.js';
import { createStore } from './store.js';
import { createRouteErrorPanel } from '../lib/route-error-panel.js';

/**
 * What a page module's `createRouteSlice` hands back.
 *
 * @template Context
 * @typedef {{
 *   initialState: any,
 *   reducer: (state: any, action: any) => any,
 *   view?: (state: any, tools: { dispatch: (action: any) => any, memo: any, params: Record<string, string>, context: Context }) => any,
 *   render?: (container: Element, state: any, tools: { dispatch: (action: any) => any, memo: any, render: typeof render, params: Record<string, string>, context: Context }) => void,
 *   start?: (tools: { dispatch: (action: any) => any, memo: any, params: Record<string, string>, context: Context, isActive: () => boolean, signal: AbortSignal, listen: (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void }) => void | (() => void),
 * }} RouteSlice
 */

/**
 * A store-driven page module, however the route table got hold of it.
 *
 * @template Context
 * @typedef {{
 *   createRouteSlice: (params: Record<string, string>, context: Context) => RouteSlice<Context>
 * }} PageModule
 */

/**
 * Adapt a store-driven page module to the existing Router handler shape. The
 * adapter owns the route-local store, memo cache, and listener cleanup.
 *
 * The page arrives either already resolved (`page`) or behind a thunk that
 * fetches it on first navigation (`load`). Exactly one of the two, because a
 * route with neither has no page to mount and a route with both leaves it
 * ambiguous which one is the page.
 *
 * @template Context
 * @param {{
 *   page?: PageModule<Context>,
 *   load?: () => Promise<PageModule<Context>>,
 *   context: Context,
 * }} options
 * @returns {import('../lib/router.js').RouteHandler}
 */
export function createStoreRoute({ page, load, context }) {
  if (Boolean(page) === Boolean(load)) {
    throw new TypeError('createStoreRoute needs exactly one of { page, load }');
  }

  let mountSequence = 0;
  /** @type {null | (() => void)} */
  let disposeMountedSlice = null;

  return {
    async mount(container, params) {
      const token = ++mountSequence;
      // The cast only tells the type checker what the check above guarantees.
      const module =
        page ??
        (await /** @type {() => Promise<PageModule<Context>>} */ (load)());

      // Router.unmount() may run while a lazy import is pending. Do not let a
      // stale module create a store or attach listeners after navigation. A
      // resolved page never waits, so it never lands in that window.
      if (token !== mountSequence) return;

      const slice = module.createRouteSlice(params, context);
      const memo = createMemo();
      /** @type {Array<() => void>} */
      const removeListeners = [];
      /** @type {ReturnType<typeof createStore<any, any>>} */
      let store;
      // Set once the initial synchronous render has succeeded. Before that, a
      // render failure propagates to mount()'s catch, which disposes and
      // rethrows so the router's containment handles it. After it,
      // renders run coalesced on a microtask with no other try/catch on the
      // path, so this callback must contain failures itself.
      let mounted = false;
      // The mount lifetime, owned here and exposed to the slice. A route effect
      // guards a late `.then()` with isActive() instead of hand-rolling its own
      // latch; the signal is the same lifetime in AbortSignal form.
      const controller = new AbortController();
      const tools = {
        dispatch: (/** @type {any} */ action) => store.dispatch(action),
        memo,
        render,
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
        onStateChange: (state) => {
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
            render(container, slice.view(state, tools));
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
        store.flush();
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
 * Register one store-driven page on one or more hash patterns.
 *
 * Without a guard the adapter is registered directly, so nothing sits between
 * the router and `createStoreRoute`.
 *
 * The page reference is the caller's, whether it is a module the route table
 * imported or a thunk that fetches one. Naming a page is the route table's job
 * and this helper never does it.
 *
 * `guard` runs on every mount, before anything else. Returning false skips the
 * mount entirely — the shape an eligibility bounce needs. It buys the
 * short-circuit, not the download: for a page the route table imports, the
 * module is already in memory, but no slice, store or effect runs for an
 * ineligible user.
 *
 * @template Context
 * @param {import('../lib/router.js').Router} router
 * @param {{
 *   paths: string[],
 *   page?: Parameters<typeof createStoreRoute<Context>>[0]['page'],
 *   load?: Parameters<typeof createStoreRoute<Context>>[0]['load'],
 *   context: Context,
 *   guard?: () => boolean,
 * }} options
 * @returns {void}
 */
export function registerStoreRoute(
  router,
  { paths, page, load, context, guard }
) {
  const handler = createStoreRoute({ page, load, context });
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
