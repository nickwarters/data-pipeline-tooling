// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {() => Promise<typeof import('../pages/cora-case-review.js')>} [loadPage]
 */
export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-case-review.js')
) {
  /** @type {import('../lib/router.js').RouteHandler} */
  const handler = {
    async mount(container, params) {
      const { CaseReviewPage } = await loadPage();
      container.replaceChildren(
        CaseReviewPage({
          client: context.client,
          saveQueue: context.saveQueue,
          caseId: params.id,
          caseType: params.caseType ?? null,
          currentUserId: context.currentUser.id,
          capabilities: context.capabilities,
        })
      );
    },
    unmount() {},
  };

  router.register('#/case/:caseType/:id', handler);
  router.register('#/case/:id', handler);
}
