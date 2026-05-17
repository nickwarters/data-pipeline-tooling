// @ts-check

/**
 * @param {import('../router.js').Router} router
 * @param {import('../register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/case/:id', {
    mount(container, params) {
      const el = /** @type {import('../cr-case-review.js').CRCaseReview} */ (
        document.createElement('cr-case-review')
      );
      el.client = context.client;
      el.saveQueue = context.saveQueue;
      el.caseId = params.id;
      el.currentUserId = context.currentUser.id;
      el.capabilities = context.capabilities;
      container.replaceChildren(el);
    },
    unmount() {},
  });
}
