// @ts-check
// Dev-only route for the morph() harness (CORE-2). It registers #/dev/morph
// *only* under the ?mock=1 dev loop, so it never appears in a deployed
// SharePoint environment. There is no nav link — it is reached by URL from the
// dev harness (dev/?mock=1#/dev/morph).

/**
 * @returns {boolean} whether the ?mock=1 dev loop is active
 */
function isDevMockLoop() {
  const search = /** @type {any} */ (globalThis).location?.search ?? '';
  return new URLSearchParams(search).get('mock') === '1';
}

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} _context
 * @param {{
 *   load?: () => Promise<typeof import('../pages/dev-morph-harness.js')>,
 *   isDev?: () => boolean,
 * }} [options]
 */
export function register(
  router,
  _context,
  {
    load = () => import('../pages/dev-morph-harness.js'),
    isDev = isDevMockLoop,
  } = {}
) {
  if (!isDev()) return;
  router.register('#/dev/morph', {
    async mount(container) {
      const { mountDevMorphHarness } = await load();
      mountDevMorphHarness(container);
    },
    unmount() {},
  });
}
