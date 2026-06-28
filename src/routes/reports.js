// @ts-check
import { ReportsIndexPage } from '../pages/reports-index-page.js';

// TODO(simplify-ui): Rework routing around route functions that compose
// plain function components returning h() nodes. Keep custom elements only for
// route/browser-integration shells, not as the unit every route has to create.

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
      const el =
        /** @type {import('../pages/cr-reviewer-team-report.js').CRReviewerTeamReport} */ (
          document.createElement('cr-reviewer-team-report')
        );
      el.client = context.client;
      el.currentUser = context.currentUser;
      el.eligibleCaseTypes = context.eligibleCaseTypes;
      container.replaceChildren(el);
    },
    unmount() {},
  });
}
