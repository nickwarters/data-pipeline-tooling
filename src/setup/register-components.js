// @ts-check

/** @returns {Promise<void>} */
export async function registerComponents() {
  await Promise.all([
    import('../components/cr-allocation.js'),
    import('../components/cr-owner-summary.js'),
    import('../pages/cr-dashboard.js'),
    import('../pages/cr-case-review.js'),
    import('../pages/cr-conversation-view.js'),
    // cr-bank-editor pulls in all 13 sub-components via side-effect imports.
    import('../question-bank/cr-bank-editor.js'),
  ]);
}
