// @ts-check
import * as appNavModule from '../components/sections/cora-app-nav.js';
import { createBootErrorPanel } from '../lib/boot-error-panel.js';

/**
 * Boot-time chrome mounting: the app nav and command palette, guarded so a
 * broken module for either cannot take down the whole app.
 *
 * Palette failure is contained for real: it is logged and skipped, and boot
 * continues into a usable app. That is why the palette alone is still loaded
 * on demand.
 *
 * The nav is a static import, so the fatal-nav branch below is now a
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
 *   loadPalette?: () => Promise<any>,
 *   body?: Element,
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
    loadPalette = async () => {
      const [view, state] = await Promise.all([
        import('../components/sections/cora-command-palette.js'),
        import('../services/command-palette-store.js'),
      ]);
      return { ...view, commandPaletteStore: state.commandPaletteStore };
    },
    body = document.body,
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

  /** @type {Element | null} */
  let paletteRoot = null;
  try {
    const paletteModule = await loadPalette();
    paletteRoot = document.createElement('div');
    paletteRoot.className = 'cora-command-palette';
    body.appendChild(paletteRoot);
    paletteModule.mountCommandPalette(paletteRoot, {
      store: paletteModule.commandPaletteStore,
    });
  } catch (err) {
    if (paletteRoot?.parentNode === body) body.removeChild(paletteRoot);
    console.error('[CORA] command palette failed to load', err);
  }

  return true;
}
