// @ts-check
import { createStoreRoute } from '../core/store-route.js';

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
  const handler = createStoreRoute({ load: loadPage, context });

  router.register('#/case/:caseType/:id', handler);
  router.register('#/case/:id', handler);
}
