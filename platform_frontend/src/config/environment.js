// @ts-check
/**
 * Environment resolution for the two-environment hosting model.
 *
 * The deployed host page declares its environment by setting
 * `window.CORA_ENV` from the `{{CORA_ENV}}` deploy-time token (see
 * `host/index.html` and `scripts/deploy_to_sharepoint.py`). Everything
 * environment-specific in the app derives from `resolveEnvironment()`:
 * the SharePoint list-name prefix and the Style Library base path for
 * versioned Question Bank exports. Nothing else in the codebase may branch
 * on the environment name.
 *
 * Any value other than the literal `'uat'` — including `undefined` (dev
 * loop, `?mock=1`) and an unsubstituted `'{{CORA_ENV}}'` token — resolves
 * to prod, so existing deploys and the dev loop are unaffected.
 */

/**
 * @typedef {{
 *   name: 'prod' | 'uat',
 *   listPrefix: string,
 *   exportBasePath: string
 * }} Environment
 */

const PROD_EXPORT_BASE = '/Style%20Library/case-review/case-types';
const UAT_EXPORT_BASE = '/Style%20Library/case-review-uat/case-types';

/**
 * @param {unknown} [raw] the declared environment name; defaults to the
 *   host page's `window.CORA_ENV` global.
 * @returns {Environment}
 */
export function resolveEnvironment(
  raw = /** @type {Record<string, unknown>} */ (globalThis).CORA_ENV
) {
  if (raw === 'uat') {
    return { name: 'uat', listPrefix: 'uat_', exportBasePath: UAT_EXPORT_BASE };
  }
  return { name: 'prod', listPrefix: '', exportBasePath: PROD_EXPORT_BASE };
}
