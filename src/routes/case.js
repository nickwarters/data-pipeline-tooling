// @ts-check
import { CaseReviewPage } from '../pages/cr-case-review.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  /** @type {import('../lib/router.js').RouteHandler} */
  const handler = {
    mount(container, params) {
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
