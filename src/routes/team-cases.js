// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/team-cases', {
    mount(container) {
      const el =
        /** @type {import('../pages/cr-team-cases.js').CRTeamCases} */ (
          document.createElement('cr-team-cases')
        );
      el.client = context.client;
      el.currentUser = context.currentUser;
      el.eligibleCaseTypes = context.eligibleCaseTypes;
      el.queryString = location.hash.includes('?')
        ? location.hash.slice(location.hash.indexOf('?'))
        : '';
      container.replaceChildren(el);
    },
    unmount() {},
  });
}
