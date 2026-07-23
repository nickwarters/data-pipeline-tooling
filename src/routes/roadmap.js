// @ts-check
import { createStoreRoute } from '../core/store-route.js';

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
  const storeRoute = createStoreRoute({ load: loadPage, context });
  router.register('#/roadmap', {
    mount(container, params) {
      return storeRoute.mount(container, params);
    },
    unmount() {
      storeRoute.unmount();
    },
  });
}
