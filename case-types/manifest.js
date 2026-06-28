// @ts-check

/**
 * @typedef {() => Promise<{ default: import('../src/sharepoint-client.js').CaseTypeConfig }>} CaseTypeImporter
 */

/**
 * TODO(issue-199): Replace data-constructed Case Type imports with this
 * allow-list. Add one entry per supported Case Type slug, for example
 * `example-review`, `product-sale-review`, `qa-example-review`, and
 * `stress-review`, each pointing at a static `import('./<slug>.js')` function.
 *
 * @type {Record<string, CaseTypeImporter>}
 */
export const CASE_TYPE_IMPORTERS = {};

/**
 * TODO(issue-199): Resolve a Case Type slug through `CASE_TYPE_IMPORTERS`,
 * returning the loaded config for known slugs and throwing a developer-useful
 * unknown-slug error for malformed or unsupported SharePoint row data.
 *
 * @param {string} _slug
 * @returns {Promise<import('../src/sharepoint-client.js').CaseTypeConfig>}
 */
export async function loadCaseTypeConfig(_slug) {
  throw new Error('TODO(issue-199): load Case Type config from manifest.');
}
