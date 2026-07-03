// @ts-check
/**
 * Instantiates the correct SharePointClient for the current environment.
 * Pass `?mock=1` to get a MockSharePointClient backed by dev fixtures.
 * Pass `?asUser=<persona>` to select a fixture persona (default: 'reviewer').
 *
 * @param {URLSearchParams} params
 * @returns {Promise<import('../sharepoint-client.js').SharePointClient>}
 */
export async function createSharePointClient(params) {
  if (params.get('mock') === '1') {
    const persona = params.get('asUser') ?? 'reviewer';
    const [
      { MockSharePointClient },
      { loadCaseTypeConfig },
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

    // A Case Type may declare its own SharePoint list (ADR-0007) via `listName`;
    // its Cases are then read/written list-scoped. Partition the flat fixture
    // array by each Case Type's `listName` so list-backed Cases land in the
    // mock client's per-list stores instead of 404-ing in the mock dev loop
    // (issue #249). Cases whose Case Type declares no list stay in the default
    // store.
    const { cases: defaultCases, lists } = await partitionCasesByList(
      cases,
      loadCaseTypeConfig
    );

    return new MockSharePointClient({
      cases: defaultCases,
      questionDefinitions,
      personas,
      persona,
      people,
      lists,
    });
  }

  const { HttpSharePointClient } = await import('./http-sharepoint-client.js');
  return new HttpSharePointClient();
}

/**
 * Split a flat fixture Case array into the default store plus per-list stores,
 * keyed by each Case Type's declared `listName`. Used to hydrate the mock
 * client so list-backed Case Types are openable under `?mock=1` (issue #249).
 *
 * @param {import('../sharepoint-client.js').CaseRow[]} cases
 * @param {(slug: string) => Promise<import('../sharepoint-client.js').CaseTypeConfig>} loadCaseTypeConfig
 * @returns {Promise<{ cases: import('../sharepoint-client.js').CaseRow[], lists: Record<string, import('../sharepoint-client.js').CaseRow[]> }>}
 */
async function partitionCasesByList(cases, loadCaseTypeConfig) {
  /** @type {Record<string, string | undefined>} */
  const listNameByCaseType = {};
  for (const caseType of new Set(cases.map((c) => c.caseType))) {
    const config = await loadCaseTypeConfig(caseType);
    listNameByCaseType[caseType] = config.listName;
  }

  /** @type {import('../sharepoint-client.js').CaseRow[]} */
  const defaultCases = [];
  /** @type {Record<string, import('../sharepoint-client.js').CaseRow[]>} */
  const lists = {};
  for (const c of cases) {
    const listName = listNameByCaseType[c.caseType];
    if (listName) (lists[listName] ??= []).push(c);
    else defaultCases.push(c);
  }
  return { cases: defaultCases, lists };
}
