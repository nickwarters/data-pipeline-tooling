// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/reports', {
    mount(container) {
      const el = /** @type {import('../pages/cr-reports-index.js').CRReportsIndex} */ (
        document.createElement('cr-reports-index')
      );
      el.capabilities = context.capabilities;
      container.replaceChildren(el);
    },
    unmount() {},
  });

  router.register('#/reports/reviewer-team', {
    mount(container) {
      container.replaceChildren(document.createElement('cr-reviewer-team-report'));
    },
    unmount() {},
  });
}
