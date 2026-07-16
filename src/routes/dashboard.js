// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-dashboard.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-dashboard.js')
) {
  router.register('#/dashboard', {
    async mount(container) {
      const { DashboardPage } = await loadPage();
      container.replaceChildren(
        DashboardPage({
          client: context.client,
          currentUserId: context.currentUser.id,
          capabilities: context.capabilities,
          caseSources: context.caseSources,
          allCaseSources: context.caseSources,
          allocationSources: context.allocationSources,
        })
      );
    },
    unmount() {},
  });
}
