// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/dashboard', {
    mount(container) {
      const el = /** @type {import('../pages/cr-dashboard.js').CRDashboard} */ (
        document.createElement('cr-dashboard')
      );
      el.client = context.client;
      el.currentUserId = context.currentUser.id;
      el.capabilities = context.capabilities;
      el.eligibleCaseTypes = context.eligibleCaseTypes;
      container.replaceChildren(el);
    },
    unmount() {},
  });
}
