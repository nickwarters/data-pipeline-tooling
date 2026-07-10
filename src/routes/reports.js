// @ts-check
import { ReportsIndexPage } from '../pages/cora-reports-index.js';
import { ReviewerTeamReportPage } from '../pages/cora-reviewer-team-report.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/reports', {
    mount(container) {
      container.replaceChildren(
        ...ReportsIndexPage({ capabilities: context.capabilities })
      );
    },
    unmount() {},
  });

  router.register('#/reports/reviewer-team', {
    mount(container) {
      if (!context.capabilities.isReviewerManager) {
        location.hash = '#/reports';
        return;
      }
      container.replaceChildren(
        ReviewerTeamReportPage({
          client: context.client,
          currentUser: context.currentUser,
          eligibleCaseTypes: context.eligibleCaseTypes,
        })
      );
    },
    unmount() {},
  });
}
