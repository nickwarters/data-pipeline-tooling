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
 *     start?: (tools: { dispatch: (action: any) => any, memo: any, params: Record<string, string>, context: Context, listen: (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void }) => void | (() => void),
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
      // Set once the initial synchronous render (inside the try/catch below)
      // has succeeded. Before that point a render failure is left to
      // propagate to mount()'s own catch, which disposes and rethrows so the
      // router's existing ADR-0002 containment handles it. After that point
      // renders run on a schedule (see createStore's queueMicrotask
      // coalescing) with no other try/catch on the path, so this render
      // callback must contain failures itself (#437).
      let mounted = false;
      const tools = {
        dispatch: (/** @type {any} */ action) => store.dispatch(action),
        memo,
        morph,
        params,
        context,
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
