// @ts-check
import { createStoreRoute } from '../core/store-route.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-team-cases.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-team-cases.js')
) {
  const storeRoute = createStoreRoute({ load: loadPage, context });
  router.register('#/team-cases', {
    mount(container, params) {
      const hash = location.hash;
      const queryString = hash.includes('?')
        ? hash.slice(hash.indexOf('?'))
        : '';
      return storeRoute.mount(container, { ...params, queryString });
    },
    unmount() {
      storeRoute.unmount();
    },
  });
}
