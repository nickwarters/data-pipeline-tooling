// @ts-check
import { registerStoreRoute } from '../core/store-route.js';

/**
 * The only route whose page loader is itself overridable from `AppContext`:
 * the dev/mock harness swaps the bank editor in through
 * `context.loadQuestionBankEditor`. That stays in the `loadPage` default, so
 * the real page's dynamic `import()` still lives here in `src/routes/*`.
 *
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
  registerStoreRoute(router, {
    paths: ['#/question-bank'],
    load: loadPage,
    context,
  });
}
