// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-responsible-party-dashboard.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-responsible-party-dashboard.js')
) {
  router.register('#/my-cases', {
    async mount(container) {
      const { ResponsiblePartyDashboard } = await loadPage();
      // Note: no onOpenConversation is wired here, matching the previous
      // behaviour where the element's 'cora-open-conversation' event had no
      // listener on this route (only cora-dashboard listened for it).
      container.replaceChildren(
        ResponsiblePartyDashboard({
          client: context.client,
          currentUserId: context.currentUser.id,
          // Advisers span all Case Type sources, but the dashboard keeps every
          // per-list read scoped to this user's Responsible Party field.
          allCaseSources: context.caseSources,
        })
      );
    },
    unmount() {},
  });
}
