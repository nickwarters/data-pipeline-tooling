// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/my-cases', {
    mount(container) {
      const el =
        /** @type {import('../pages/cr-responsible-party-dashboard.js').CRResponsiblePartyDashboard} */ (
          document.createElement('cr-responsible-party-dashboard')
        );
      el.client = context.client;
      el.currentUserId = context.currentUser.id;
      container.replaceChildren(el);
    },
    unmount() {},
  });
}
