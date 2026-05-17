// @ts-check

/**
 * Instantiates the correct SharePointClient for the current environment.
 * Pass `?mock=1` to get a MockSharePointClient backed by dev fixtures.
 * Pass `?asUser=<persona>` to select a fixture persona (default: 'reviewer').
 *
 * @param {URLSearchParams} params
 * @returns {Promise<import('./sharepoint-client.js').SharePointClient>}
 */
export async function createSharePointClient(params) {
  if (params.get('mock') === '1') {
    const persona = params.get('asUser') ?? 'reviewer';
    const [{ MockSharePointClient }, { cases }, { questionDefinitions }, { personas }] = await Promise.all([
      import('./mock-sharepoint-client.js'),
      import('../dev/fixtures/cases.js'),
      import('../dev/fixtures/question-definitions.js'),
      import('../dev/fixtures/personas.js'),
    ]);
    return new MockSharePointClient({ cases, questionDefinitions, personas, persona });
  }

  const { HttpSharePointClient } = await import('./http-sharepoint-client.js');
  return new HttpSharePointClient();
}
