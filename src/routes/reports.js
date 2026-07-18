// @ts-check
import { createStoreRoute } from '../core/store-route.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{
 *   loadIndex?: () => Promise<typeof import('../pages/reports-index.js')>,
 *   loadReviewerTeam?: () => Promise<typeof import('../pages/cora-reviewer-team-report.js')>,
 * }} [loaders]
 */
export function register(
  router,
  context,
  {
    loadIndex = () => import('../pages/reports-index.js'),
    loadReviewerTeam = () => import('../pages/cora-reviewer-team-report.js'),
  } = {}
) {
  router.register(
    '#/reports',
    createStoreRoute({ load: loadIndex, context })
  );

  router.register('#/reports/reviewer-team', {
    async mount(container) {
      if (!context.capabilities.isReviewerManager) {
        location.hash = '#/reports';
        return;
      }
      const { ReviewerTeamReportPage } = await loadReviewerTeam();
      container.replaceChildren(
        ReviewerTeamReportPage({
          client: context.client,
          currentUser: context.currentUser,
          caseSources: context.caseSources,
        })
      );
    },
    unmount() {},
  });
}
