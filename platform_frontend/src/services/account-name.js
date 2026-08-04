// @ts-check
/**
 * Claims/domain encoding for this single-farm, single-domain SharePoint SE
 * deployment. This is the one place the encoding lives: components
 * and the `cora-people-picker` only ever see bare account names; the claims
 * prefix and AD domain are stripped here at the service boundary.
 */

/** The on-prem AD claims provider prefix, e.g. `i:0#.w|CONTOSO\jsmith`. */
export const CLAIMS_PREFIX = 'i:0#.w|';

/** The single AD domain for this farm. */
export const AD_DOMAIN = 'CONTOSO';

/**
 * Reattach the claims prefix and AD domain to a bare account name, producing the
 * full claims login string the SharePoint/User Profile API expects. The inverse
 * of {@link toBareAccount} for this single-domain farm.
 *
 * @param {string} account
 * @returns {string}
 */
export function toClaimsLogin(account) {
  return `${CLAIMS_PREFIX}${AD_DOMAIN}\\${account}`;
}

/**
 * Reduce a people-picker `Key` (or any login string) to its bare account name:
 * strips the claims prefix and any `DOMAIN\` segment.
 *
 * @param {string} key
 * @returns {string}
 */
export function toBareAccount(key) {
  let s = String(key ?? '').trim();
  if (s.startsWith(CLAIMS_PREFIX)) s = s.slice(CLAIMS_PREFIX.length);
  const slash = s.lastIndexOf('\\');
  return slash === -1 ? s : s.slice(slash + 1);
}
