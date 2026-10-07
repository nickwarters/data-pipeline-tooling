// @ts-check
/**
 * Claims/domain encoding for this single-farm SharePoint SE deployment. This is
 * the one place the encoding lives: components and the `cora-people-picker`
 * only ever see bare account names; the claims prefix and AD domain are
 * stripped here at the service boundary and the known domain reattached there.
 */

/** The on-prem AD claims provider prefix, e.g. `i:0#.w|CONTOSO\jsmith`. */
export const CLAIMS_PREFIX = 'i:0#.w|';

/** The default AD domain for this farm, assumed for an account whose own domain is unknown. */
export const AD_DOMAIN = 'CONTOSO';

/**
 * The full claims login SharePoint expects for a bare account; an empty domain means `AD_DOMAIN`.
 *
 * @param {string} account
 * @param {string} [domain]
 * @returns {string}
 */
export function toClaimsLogin(account, domain = '') {
  return `${CLAIMS_PREFIX}${domain || AD_DOMAIN}\\${account}`;
}

/**
 * The domain segment of a login string, before the last `\` and without the claims prefix; `''` when it names none.
 *
 * @param {string} key
 * @returns {string}
 */
export function toAccountDomain(key) {
  let s = String(key ?? '').trim();
  if (s.startsWith(CLAIMS_PREFIX)) s = s.slice(CLAIMS_PREFIX.length);
  const slash = s.lastIndexOf('\\');
  return slash === -1 ? '' : s.slice(0, slash);
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
