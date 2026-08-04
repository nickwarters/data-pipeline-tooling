// @ts-check
import * as appNavModule from '../components/sections/cora-app-nav.js';
import { createBootErrorPanel } from '../lib/boot-error-panel.js';

/**
 * Boot-time chrome mounting: the app nav, guarded so a broken nav module
 * renders a message rather than a blank app.
 *
 * The nav is a static import, so the fatal branch below is now a
 * test-injection path rather than a production failure mode: a nav module that
 * fails to fetch breaks module evaluation before boot runs at all, which the
 * boot-error panel cannot catch (see `app.js`). Deferring the nav did buy a
 * visible message for that case; the panel's stated limit is where that
 * trade now sits. The branch is kept because injecting a failing loader is how
 * the fatal path is tested at all.
 */

/**
 * @param {Element} appEl
 * @param {import('../services/permissions.js').Capabilities} capabilities
 * @param {{
 *   loadNav?: () => Promise<typeof appNavModule>,
 *   navigationTarget?: any,
 *   readHash?: () => string,
 * }} [options]
 * @returns {Promise<boolean>} false when nav failed to load (fatal message already rendered)
 */
export async function mountAppChrome(
  appEl,
  capabilities,
  {
    // A thunk, not the module itself, purely so a test can inject one that
    // rejects; the default can never reject.
    loadNav = async () => appNavModule,
    navigationTarget = window,
    readHash = () => location.hash || '#/',
  } = {}
) {
  let navModule;
  try {
    navModule = await loadNav();
  } catch (err) {
    console.error('[CORA] app nav failed to load', err);
    appEl.replaceChildren(
      createBootErrorPanel(
        'CORA failed to start: navigation could not load. Reload to retry.'
      )
    );
    return false;
  }

  const { node: nav, navItems } = navModule.AppNav({
    capabilities,
    hash: readHash(),
  });
  appEl.appendChild(nav);
  navigationTarget.addEventListener('hashchange', () =>
    navModule.updateActiveNavItems(navItems, readHash())
  );

  return true;
}
