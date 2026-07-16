// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{
 *   loadIndex?: () => Promise<typeof import('../pages/cora-reports-index.js')>,
 *   loadReviewerTeam?: () => Promise<typeof import('../pages/cora-reviewer-team-report.js')>,
 * }} [loaders]
 */
export function register(
  router,
  context,
  {
    loadIndex = () => import('../pages/cora-reports-index.js'),
    loadReviewerTeam = () => import('../pages/cora-reviewer-team-report.js'),
  } = {}
) {
  router.register('#/reports', {
    async mount(container) {
      const { ReportsIndexPage } = await loadIndex();
      container.replaceChildren(
        ...ReportsIndexPage({ capabilities: context.capabilities })
      );
    },
    unmount() {},
  });

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
