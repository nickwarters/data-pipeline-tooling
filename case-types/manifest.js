// @ts-check

/**
 * @typedef {() => Promise<{ default: import('../src/sharepoint-client.js').CaseTypeConfig }>} CaseTypeImporter
 */

/**
 * @type {Record<string, CaseTypeImporter>}
 */
export const CASE_TYPE_IMPORTERS = {
  'example-review': () => import('./example-review.js'),
  'product-sale-review': () => import('./product-sale-review.js'),
  'qa-example-review': () => import('./qa-example-review.js'),
  'stress-review': () => import('./stress-review.js'),
};

export class UnknownCaseTypeError extends Error {
  /**
   * @param {string} slug
   */
  constructor(slug) {
    super(`Unknown Case Type slug "${slug}".`);
    this.name = 'UnknownCaseTypeError';
    this.slug = slug;
  }
}

/**
 * @param {string} slug
 * @returns {Promise<import('../src/sharepoint-client.js').CaseTypeConfig>}
 */
export async function loadCaseTypeConfig(slug) {
  const importer = CASE_TYPE_IMPORTERS[slug];
  if (!importer) {
    throw new UnknownCaseTypeError(slug);
  }
  const mod = await importer();
  return mod.default;
}
