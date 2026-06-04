// @ts-check

/**
 * Claims/domain encoding for this single-farm, single-domain SharePoint SE
 * deployment (ADR-0013). This is the one place the encoding lives: components
 * and the `cr-people-picker` only ever see bare account names; the claims
 * prefix and AD domain are stripped here at the service boundary.
 */

/** The on-prem AD claims provider prefix, e.g. `i:0#.w|CONTOSO\jsmith`. */
export const CLAIMS_PREFIX = 'i:0#.w|';

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
