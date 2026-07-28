// @ts-check
/**
 * Boot-time chrome mounting: the app nav and command palette, guarded so a
 * broken module for either cannot take down the whole app.
 *
 * Nav failure is fatal-with-message: without nav the app is unusable, so a
 * plain-DOM error panel is rendered into `appEl` and boot stops. Palette
 * failure is non-fatal: it is logged and skipped, boot continues.
 */

/**
 * @param {Element} appEl
 * @param {import('../services/permissions.js').Capabilities} capabilities
 * @param {{
 *   loadNav?: () => Promise<typeof import('../components/sections/cora-app-nav.js')>,
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
    loadNav = () => import('../components/sections/cora-app-nav.js'),
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
    const panel = document.createElement('div');
    panel.className = 'cora-boot-error';
    panel.textContent =
      'CORA failed to start: navigation could not load. Reload to retry.';
    appEl.replaceChildren(panel);
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
