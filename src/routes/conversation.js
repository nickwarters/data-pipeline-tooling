// @ts-check
// TODO(simplify-ui): Rework routing around route functions that compose
// plain function components returning h() nodes. Keep custom elements only for
// route/browser-integration shells, not as the unit every route has to create.

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/conversation/:id', {
    mount(container, params) {
      const el =
        /** @type {import('../pages/cr-conversation-view.js').CRConversationView} */ (
          document.createElement('cr-conversation-view')
        );
      el.client = context.client;
      el.saveQueue = context.saveQueue;
      el.caseId = params.id;
      el.currentUser = context.currentUser;
      container.replaceChildren(el);
    },
    unmount() {},
  });
}
