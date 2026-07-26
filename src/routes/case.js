// @ts-check
import { registerStoreRoute } from '../core/store-route.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-case-review.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-case-review.js')
) {
  registerStoreRoute(router, {
    paths: ['#/case/:caseType/:id', '#/case/:id'],
    load: loadPage,
    context,
  });
}
