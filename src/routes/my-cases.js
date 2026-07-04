// @ts-check
import { ResponsiblePartyDashboard } from '../pages/cora-responsible-party-dashboard.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/my-cases', {
    mount(container) {
      // Note: no onOpenConversation is wired here, matching the previous
      // behaviour where the element's 'cora-open-conversation' event had no
      // listener on this route (only cora-dashboard listened for it).
      container.replaceChildren(
        ResponsiblePartyDashboard({
          client: context.client,
          currentUserId: context.currentUser.id,
        })
      );
    },
    unmount() {},
  });
}
