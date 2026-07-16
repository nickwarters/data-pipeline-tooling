// @ts-check

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
  /** @type {import('../lib/router.js').RouteHandler} */
  const handler = {
    async mount(container, params) {
      const { ConversationView } = await loadPage();
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
