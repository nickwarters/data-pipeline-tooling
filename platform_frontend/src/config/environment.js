// @ts-check
/**
 * Environment resolution for the two-environment hosting model.
 *
 * The deployed host page declares its environment by setting
 * `window.CORA_ENV` from the `{{CORA_ENV}}` deploy-time token (see
 * `host/index.html` and `scripts/deploy_to_sharepoint.py`). The one thing
 * that derives from `resolveEnvironment()` is the SharePoint list-name
 * prefix. Nothing else in the codebase may branch on the environment name.
 *
 * There is deliberately no export base path here any more. Question Bank
 * artifacts — the bank and its published versions alike — are read out of the
 * deployed `case-types/banks/` folder, resolved relative to the module that
 * reads them, so each deploy reads its own artifacts without being told where
 * it lives. A second declaration of "which environment am I" is a thing that
 * can disagree with the first.
 *
 * Any value other than the literal `'uat'` — including `undefined` (dev
 * loop, `?mock=1`) and an unsubstituted `'{{CORA_ENV}}'` token — resolves
 * to prod, so existing deploys and the dev loop are unaffected.
 */

/**
 * @typedef {{
 *   name: 'prod' | 'uat',
 *   listPrefix: string
 * }} Environment
 */

/**
 * @param {unknown} [raw] the declared environment name; defaults to the
 *   host page's `window.CORA_ENV` global.
 * @returns {Environment}
 */
export function resolveEnvironment(
  raw = /** @type {Record<string, unknown>} */ (globalThis).CORA_ENV
) {
  if (raw === 'uat') {
    return { name: 'uat', listPrefix: 'uat_' };
  }
  return { name: 'prod', listPrefix: '' };
}
