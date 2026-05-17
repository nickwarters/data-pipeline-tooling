// @ts-check

/** @returns {Promise<void>} */
export async function registerComponents() {
  await Promise.all([
    import('./cr-allocation.js'),
    import('./cr-owner-summary.js'),
    import('./cr-dashboard.js'),
    import('./cr-case-review.js'),
    import('./cr-conversation-view.js'),
    // cr-bank-editor pulls in all 13 sub-components via side-effect imports.
    import('./cr-bank-editor.js'),
  ]);
}
