// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-team-cases.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-team-cases.js')
) {
  router.register('#/team-cases', {
    async mount(container) {
      const queryString = location.hash.includes('?')
        ? location.hash.slice(location.hash.indexOf('?'))
        : '';
      const { TeamCasesPage } = await loadPage();
      container.replaceChildren(
        TeamCasesPage({
          client: context.client,
          currentUser: context.currentUser,
          caseSources: context.caseSources,
          queryString,
        })
      );
    },
    unmount() {},
  });
}
