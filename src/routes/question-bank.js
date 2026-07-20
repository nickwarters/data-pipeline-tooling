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
    context.loadQuestionBankEditor ??
      (() => import('../pages/question-bank/cora-bank-editor.js'))
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
