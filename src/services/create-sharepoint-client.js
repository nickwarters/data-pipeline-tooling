// @ts-check
import { resolveEnvironment } from '../config/environment.js';

/**
 * Instantiates the correct SharePointClient for the current environment.
 * Pass `?mock=1` to get a MockSharePointClient backed by dev fixtures.
 * Pass `?asUser=<persona>` to select a fixture persona (default: 'reviewer').
 *
 * `env` (ADR-0033) scopes the real HTTP client to the deployment
 * environment's lists and export path; it never affects the mock client.
 *
 * @param {URLSearchParams} params
 * @param {import('../config/environment.js').Environment} [env]
 * @returns {Promise<import('../sharepoint-client.js').SharePointClient>}
 */
export async function createSharePointClient(
  params,
  env = resolveEnvironment()
) {
  if (params.get('mock') === '1') {
    const persona = params.get('asUser') ?? 'reviewer';
    const [
      { MockSharePointClient },
      { CASE_TYPE_IMPORTERS, loadCaseTypeConfig },
      { cases },
      { questionDefinitions },
      { personas },
      { people },
    ] = await Promise.all([
      import('./mock-sharepoint-client.js'),
      import('../../case-types/manifest.js'),
      import('../../dev/fixtures/cases.js'),
      import('../../dev/fixtures/question-definitions.js'),
      import('../../dev/fixtures/personas.js'),
      import('../../dev/fixtures/people.js'),
    ]);

    // `example-review` was retired from the production manifest (#383) but its
    // demo Cases remain in the dev fixtures as a rich exemplar. The mock client
    // is dev-only tooling that already lives on dev/fixtures, so it resolves the
    // fixture's config here without reintroducing it to the production manifest.
    const mockImporters = {
      ...CASE_TYPE_IMPORTERS,
      'example-review': () =>
        import('../../dev/fixtures/example-review-case-type.js'),
    };

    // Every Case Type declares its own SharePoint list via `listName`; its
    // Cases are read/written list-scoped. Partition the flat fixture array by
    // each Case Type's `listName` into the mock client's per-list stores.
    // There is no default store — the partition is total.
    const lists = await partitionCasesByList(cases, (slug) =>
      loadCaseTypeConfig(slug, mockImporters)
    );

    return new MockSharePointClient({
      questionDefinitions,
      personas,
      persona,
      people,
      lists,
    });
  }

  const { HttpSharePointClient } = await import('./http-sharepoint-client.js');
  return new HttpSharePointClient({
    listPrefix: env.listPrefix,
    exportBasePath: env.exportBasePath,
  });
}

/**
 * Partition a flat fixture Case array into per-list stores, keyed by each Case
 * Type's declared `listName`. The partition is total — there is no default
 * store — so a Case Type whose config declares no list is a fixture/config
 * error and throws loudly rather than stranding its Cases.
 *
 * @param {import('../sharepoint-client.js').CaseRow[]} cases
 * @param {(slug: string) => Promise<import('../sharepoint-client.js').CaseTypeConfig>} loadCaseTypeConfig
 * @returns {Promise<Record<string, import('../sharepoint-client.js').CaseRow[]>>}
 */
export async function partitionCasesByList(cases, loadCaseTypeConfig) {
  /** @type {Record<string, string>} */
  const listNameByCaseType = {};
  for (const caseType of new Set(cases.map((c) => c.caseType))) {
    const config = await loadCaseTypeConfig(caseType);
    if (!config.listName) {
      throw new Error(
        `partitionCasesByList: Case Type "${caseType}" declares no listName; ` +
          `every fixture Case must map to a named list (there is no default store).`
      );
    }
    listNameByCaseType[caseType] = config.listName;
  }

  /** @type {Record<string, import('../sharepoint-client.js').CaseRow[]>} */
  const lists = {};
  for (const c of cases) {
    const listName = listNameByCaseType[c.caseType];
    (lists[listName] ??= []).push(c);
  }
  return lists;
}
