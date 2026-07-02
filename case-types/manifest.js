// @ts-check
// TODO(simplify-ui): Keep case-type configuration as plain data for the
// function-component UI. Screens should consume these definitions through
// explicit props/signals, without custom-element lifecycle or controller wiring
// leaking into configuration modules.

/**
 * @typedef {() => Promise<{ default: import('../src/sharepoint-client.js').CaseTypeConfig }>} CaseTypeImporter
 */

/**
 * @type {Record<string, CaseTypeImporter>}
 */
export const CASE_TYPE_IMPORTERS = {
  'example-review': () => import('./example-review.js'),
  'product-sale-review': () => import('./product-sale-review.js'),
  'stress-review': () => import('./stress-review.js'),
  complaints: () => import('./complaints.js'),
};

export class UnknownCaseTypeError extends Error {
  /**
   * @param {string} slug
   * @param {string[]} knownSlugs
   */
  constructor(slug, knownSlugs) {
    super(
      `Unsupported Case Type slug "${slug}". Known Case Type slugs: ${knownSlugs.join(', ')}.`
    );
    this.name = 'UnknownCaseTypeError';
    this.slug = slug;
    this.knownSlugs = knownSlugs;
  }
}

/**
 * @param {string} slug
 * @returns {Promise<import('../src/sharepoint-client.js').CaseTypeConfig>}
 */
export async function loadCaseTypeConfig(slug) {
  const importer = CASE_TYPE_IMPORTERS[slug];
  if (!importer) {
    throw new UnknownCaseTypeError(
      slug,
      Object.keys(CASE_TYPE_IMPORTERS).sort()
    );
  }
  const mod = await importer();
  return mod.default;
}
