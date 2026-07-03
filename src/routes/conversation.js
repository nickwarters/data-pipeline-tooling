// @ts-check
import { ConversationView } from '../pages/cr-conversation-view.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  /** @type {import('../lib/router.js').RouteHandler} */
  const handler = {
    mount(container, params) {
      container.replaceChildren(
        ConversationView({
          client: context.client,
          saveQueue: context.saveQueue,
          caseId: params.id,
          caseType: params.caseType ?? null,
          currentUser: context.currentUser,
        })
      );
    },
    unmount() {},
  };

  router.register('#/conversation/:caseType/:id', handler);
  router.register('#/conversation/:id', handler);
}
