// @ts-check

/** @returns {Promise<void>} */
export async function registerComponents() {
  await Promise.all([
    import('../components/cr-allocation.js'),
    import('../components/cr-app-nav.js'),
    import('../components/cr-tabs.js'),
    import('../components/cr-command-palette.js'),
    import('../components/cr-owner-summary.js'),
    import('../components/cr-case-details.js'),
    import('../pages/cr-dashboard.js'),
    import('../pages/cr-case-review.js'),
    import('../pages/cr-conversation-view.js'),
    import('../pages/cr-reports-index.js'),
    import('../pages/cr-reviewer-team-report.js'),
    // cr-bank-editor pulls in all 13 sub-components via side-effect imports.
    import('../question-bank/cr-bank-editor.js'),
  ]);
  document.body.appendChild(document.createElement('cr-command-palette'));
}
