// @ts-check
/**
 * UAT environment indicator (ADR-0033). Mounted once at boot: a fixed badge
 * that makes it unmistakable which environment is being edited, so UAT
 * testing is never mistaken for production (or vice versa). Prod renders
 * nothing — the production UI is unchanged.
 */

/**
 * @param {import('../config/environment.js').Environment} env
 * @param {Element} appEl
 * @returns {Element | null} the mounted banner, or null on prod
 */
export function mountUatBanner(env, appEl) {
  if (env.name === 'prod') return null;
  const banner = document.createElement('div');
  banner.className = 'cora-uat-banner';
  banner.setAttribute('role', 'note');
  banner.textContent = `${env.name.toUpperCase()} environment — changes are saved to ${env.listPrefix}* lists, not production`;
  appEl.appendChild(banner);
  return banner;
}
