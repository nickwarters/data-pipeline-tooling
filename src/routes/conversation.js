// @ts-check

/**
 * @param {import('../router.js').Router} router
 * @param {import('../register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/conversation/:id', {
    mount(container, params) {
      const el = /** @type {import('../cr-conversation-view.js').CRConversationView} */ (
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
