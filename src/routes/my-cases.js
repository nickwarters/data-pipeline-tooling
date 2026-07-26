// @ts-check
import { registerStoreRoute } from '../core/store-route.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-responsible-party-dashboard.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-responsible-party-dashboard.js')
) {
  registerStoreRoute(router, {
    paths: ['#/my-cases'],
    load: loadPage,
    context,
  });
}
