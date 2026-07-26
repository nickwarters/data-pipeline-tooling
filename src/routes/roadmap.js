// @ts-check
import { registerStoreRoute } from '../core/store-route.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/roadmap.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/roadmap.js')
) {
  registerStoreRoute(router, {
    paths: ['#/roadmap'],
    load: loadPage,
    context,
  });
}
