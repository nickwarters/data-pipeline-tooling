// @ts-check
/**
 * Boot-time chrome mounting: the app nav and command palette, guarded so a
 * broken module for either cannot take down the whole app (#384 phase 3).
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
 *   loadPalette?: () => Promise<typeof import('../components/sections/cora-command-palette.js')>,
 *   body?: Element,
 * }} [options]
 * @returns {Promise<boolean>} false when nav failed to load (fatal message already rendered)
 */
export async function mountAppChrome(
  appEl,
  capabilities,
  {
    loadNav = () => import('../components/sections/cora-app-nav.js'),
    loadPalette = () =>
      import('../components/sections/cora-command-palette.js'),
    body = document.body,
  } = {}
) {
  try {
    await loadNav();
  } catch (err) {
    console.error('[CORA] app nav failed to load', err);
    const panel = document.createElement('div');
    panel.className = 'cora-boot-error';
    panel.textContent =
      'CORA failed to start: navigation could not load. Reload to retry.';
    appEl.replaceChildren(panel);
    return false;
  }

  const nav =
    /** @type {import('../components/sections/cora-app-nav.js').CORAAppNav} */ (
      document.createElement('cora-app-nav')
    );
  nav.capabilities = capabilities;
  appEl.appendChild(nav);

  try {
    await loadPalette();
    body.appendChild(document.createElement('cora-command-palette'));
  } catch (err) {
    console.error('[CORA] command palette failed to load', err);
  }

  return true;
}
