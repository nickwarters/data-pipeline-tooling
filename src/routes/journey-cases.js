// @ts-check
import { createStoreRoute } from '../core/store-route.js';

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
  const storeRoute = createStoreRoute({ load: loadPage, context });
  router.register('#/journey-cases', {
    mount(container, params) {
      // List-scope Journey Owner capability: only a user who
      // owns at least one Case Type as a Journey Owner may see this view.
      if (context.journeyCaseSources.length === 0) {
        location.hash = '#/';
        return;
      }
      return storeRoute.mount(container, params);
    },
    unmount() {
      storeRoute.unmount();
    },
  });
}
