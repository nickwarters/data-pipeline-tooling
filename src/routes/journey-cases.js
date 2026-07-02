// @ts-check
// TODO(simplify-ui): Rework routing around route functions that compose
// plain function components returning h() nodes. Keep custom elements only for
// route/browser-integration shells, not as the unit every route has to create.

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/journey-cases', {
    mount(container) {
      // List-scope Journey Owner capability (ADR-0022/0027): only a user who
      // owns at least one Case Type as a Journey Owner may see this view.
      if (context.capabilities.ownedJourneyCaseTypes.length === 0) {
        location.hash = '#/';
        return;
      }
      const el =
        /** @type {import('../pages/cr-journey-cases.js').CRJourneyCases} */ (
          document.createElement('cr-journey-cases')
        );
      el.client = context.client;
      el.ownedJourneyCaseTypes = context.capabilities.ownedJourneyCaseTypes;
      container.replaceChildren(el);
    },
    unmount() {},
  });
}
