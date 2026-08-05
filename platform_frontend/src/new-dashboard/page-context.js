// @ts-check

const PROD_EXPORT = '/Style%20Library/case-review/case-types';
const UAT_EXPORT = '/Style%20Library/case-review-uat/case-types';

/**
 * Translate the two browser-owned deployment values into the retained HTTP
 * client's constructor contract without importing the legacy application.
 *
 * @param {Record<string, any>} [globals]
 */
export function sharePointOptions(globals = /** @type {any} */ (globalThis)) {
  const environment = globals.CORA_ENV === 'uat' ? 'uat' : 'prod';
  const context = globals._spPageContextInfo ?? {};
  const webUrl = context.webServerRelativeUrl ?? context.webAbsoluteUrl ?? '';
  return {
    webUrl: typeof webUrl === 'string' ? webUrl : '',
    listPrefix: environment === 'uat' ? 'uat_' : '',
    exportBasePath: environment === 'uat' ? UAT_EXPORT : PROD_EXPORT,
  };
}
