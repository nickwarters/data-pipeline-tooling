// @ts-check
import { DashboardPage } from '../pages/cora-dashboard.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/dashboard', {
    mount(container) {
      container.replaceChildren(
        DashboardPage({
          client: context.client,
          currentUserId: context.currentUser.id,
          capabilities: context.capabilities,
          eligibleCaseTypes: context.eligibleCaseTypes,
        })
      );
    },
    unmount() {},
  });
}
