// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-home.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-home.js')
) {
  router.register('#/', {
    async mount() {
      const { HomePage } = await loadPage();
      context.appEl.replaceChildren(
        ...HomePage({ capabilities: context.capabilities })
      );
    },
    unmount() {
      context.appEl.replaceChildren();
    },
  });
}
