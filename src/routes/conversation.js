// @ts-check
import { registerStoreRoute } from '../core/store-route.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-conversation-view.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-conversation-view.js')
) {
  registerStoreRoute(router, {
    paths: ['#/conversation/:caseType/:id', '#/conversation/:id'],
    load: loadPage,
    context,
  });
}
