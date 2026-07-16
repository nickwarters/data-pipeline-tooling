// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-journey-cases.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-journey-cases.js')
) {
  router.register('#/journey-cases', {
    async mount(container) {
      // List-scope Journey Owner capability: only a user who
      // owns at least one Case Type as a Journey Owner may see this view.
      if (context.journeyCaseSources.length === 0) {
        location.hash = '#/';
        return;
      }
      const { JourneyCasesPage } = await loadPage();
      container.replaceChildren(
        JourneyCasesPage({
          client: context.client,
          journeyCaseSources: context.journeyCaseSources,
        })
      );
    },
    unmount() {},
  });
}
