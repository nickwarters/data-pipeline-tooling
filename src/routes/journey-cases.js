// @ts-check
import { registerStoreRoute } from '../core/store-route.js';
import { redirectTo } from '../lib/navigate.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-journey-cases.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-journey-cases.js')
) {
  registerStoreRoute(router, {
    paths: ['#/journey-cases'],
    load: loadPage,
    context,
    // List-scope Journey Owner capability: only a user who
    // owns at least one Case Type as a Journey Owner may see this view.
    // The bounce replaces rather than pushes: a pushed entry would leave
    // Back returning the user to the route that just bounced them (#519).
    guard: () => {
      if (context.journeyCaseSources.length > 0) return true;
      redirectTo('#/');
      return false;
    },
  });
}
