// @ts-check
// Dev-only CORE-5 performance gate. It is reachable only in the ?mock=1 loop
// and has no production navigation entry.
import { createStoreRoute } from '../core/store-route.js';

/** @returns {boolean} whether the ?mock=1 dev loop is active */
function isDevMockLoop() {
  const search = /** @type {any} */ (globalThis).location?.search ?? '';
  return new URLSearchParams(search).get('mock') === '1';
}

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{
 *   load?: () => Promise<{ createRouteSlice: typeof import('../pages/dev-performance-harness.js').createRouteSlice }>,
 *   isDev?: () => boolean,
 * }} [options]
 */
export function register(
  router,
  context,
  {
    load = () => import('../pages/dev-performance-harness.js'),
    isDev = isDevMockLoop,
  } = {}
) {
  if (!isDev()) return;
  router.register('#/dev/performance', createStoreRoute({ load, context }));
}
