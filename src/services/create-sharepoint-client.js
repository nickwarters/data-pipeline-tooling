// @ts-check
// TODO(simplify-ui): Keep service access as explicit plain dependencies
// passed into route shells/function components. The simplified UI should not
// require component authors to understand service classes, global singletons,
// or lifecycle wiring to perform ordinary reads and writes.

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
      { cases },
      { questionDefinitions },
      { personas },
      { people },
    ] = await Promise.all([
      import('./mock-sharepoint-client.js'),
      import('../../dev/fixtures/cases.js'),
      import('../../dev/fixtures/question-definitions.js'),
      import('../../dev/fixtures/personas.js'),
      import('../../dev/fixtures/people.js'),
    ]);
    return new MockSharePointClient({
      cases,
      questionDefinitions,
      personas,
      persona,
      people,
    });
  }

  const { HttpSharePointClient } = await import('./http-sharepoint-client.js');
  return new HttpSharePointClient();
}
