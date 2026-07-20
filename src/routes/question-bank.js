// @ts-check
import { createStoreRoute } from '../core/store-route.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/question-bank/cora-bank-editor.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = /** @type {any} */ (
    () => {
      if (!context.loadQuestionBankEditor)
        return import('../pages/question-bank/cora-bank-editor.js');
      return context
        .loadQuestionBankEditor()
        .then(async (/** @type {any} */ module) => {
          if (module?.createRouteSlice) return module;
          const search = String(
            /** @type {any} */ (globalThis).location?.search ?? ''
          );
          if (search.includes('simulate=1')) {
            const load =
              context.loadQuestionBankSamples ??
              (() =>
                import('../pages/question-bank/question-bank-samples.js').then(
                  (samples) =>
                    samples.loadSampleCases(context.client, context.caseSources)
                ));
            await load();
          }
          return legacyTestSlice(context);
        });
    }
  )
) {
  const storeRoute = createStoreRoute({ load: loadPage, context });
  router.register('#/question-bank', {
    mount(container, params) {
      return storeRoute.mount(container, params);
    },
    unmount() {
      storeRoute.unmount();
    },
  });
}

/**
 * Compatibility for route tests that inject the former side-effect-only page
 * loader. Production never takes this path; the real module exposes the slice.
 * @param {import('../setup/register-routes.js').AppContext} context
 */
function legacyTestSlice(context) {
  return {
    createRouteSlice() {
      return {
        initialState: {},
        reducer: (/** @type {any} */ state) => state,
        render(/** @type {Element} */ container) {
          container.replaceChildren(document.createElement('cora-bank-editor'));
        },
        start() {
          context.appEl.classList.add('cora-fullbleed');
          return () => context.appEl.classList.remove('cora-fullbleed');
        },
      };
    },
  };
}
