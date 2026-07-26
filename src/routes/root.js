// @ts-check
import { registerStoreRoute } from '../core/store-route.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/home.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/home.js')
) {
  registerStoreRoute(router, { paths: ['#/'], load: loadPage, context });
}
