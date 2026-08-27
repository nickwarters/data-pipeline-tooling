// @ts-check
/**
 * Environment resolution for the hosting model: one codebase, several
 * isolated deployments on the same SharePoint site.
 *
 * The deployed host page declares its environment by setting
 * `window.CORA_ENV` from the `{{CORA_ENV}}` deploy-time token (see
 * `host/index.html` and `scripts/deploy_to_sharepoint.py`). The one thing
 * that derives from `resolveEnvironment()` is the SharePoint list-name
 * prefix. Nothing else in the codebase may branch on the environment name.
 *
 * Environments are a table, not a set of literals. Prod is the unprefixed
 * baseline; every other environment follows one convention — its list prefix
 * is `${name}_`, its code folder is `CODE/CORA-${NAME}` and its host page is
 * `SitePages/${name}.app.aspx` — so adding one is a new entry in
 * `ENVIRONMENT_NAMES` here, the matching entry in the deploy script's
 * `ENVIRONMENT_NAMES` (a test holds the two lists equal), and the SharePoint
 * provisioning in `docs/guide/provisioning-an-environment.md`.
 *
 * There is deliberately no export base path here any more. Question Bank
 * artifacts — the bank and its published versions alike — are read out of the
 * deployed `case-types/banks/` folder, resolved relative to the module that
 * reads them, so each deploy reads its own artifacts without being told where
 * it lives. A second declaration of "which environment am I" is a thing that
 * can disagree with the first.
 *
 * Any value that is not a known environment name — including `undefined`
 * (dev loop, `?mock=1`) and an unsubstituted `'{{CORA_ENV}}'` token —
 * resolves to prod, so existing deploys and the dev loop are unaffected.
 */

/** The production environment: unprefixed lists, the `CODE/CORA` folder. */
export const PROD_ENVIRONMENT_NAME = 'prod';

/**
 * Every environment the app can be deployed as. Prod first; the rest are
 * non-production copies that share the site and are isolated by list prefix.
 * Must match `ENVIRONMENT_NAMES` in `scripts/deploy_to_sharepoint.py`.
 */
export const ENVIRONMENT_NAMES = Object.freeze([
  PROD_ENVIRONMENT_NAME,
  'uat',
  'training',
]);

/**
 * @typedef {{
 *   name: string,
 *   listPrefix: string
 * }} Environment
 */

/**
 * The list prefix for a known environment name: empty for prod, `${name}_`
 * for every other environment.
 * @param {string} name
 * @returns {string}
 */
export function listPrefixFor(name) {
  return name === PROD_ENVIRONMENT_NAME ? '' : `${name}_`;
}

/**
 * @param {unknown} [raw] the declared environment name; defaults to the
 *   host page's `window.CORA_ENV` global.
 * @returns {Environment}
 */
export function resolveEnvironment(
  raw = /** @type {Record<string, unknown>} */ (globalThis).CORA_ENV
) {
  const name =
    typeof raw === 'string' && ENVIRONMENT_NAMES.includes(raw)
      ? raw
      : PROD_ENVIRONMENT_NAME;
  return { name, listPrefix: listPrefixFor(name) };
}
