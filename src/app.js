// @ts-check

/** @returns {Promise<void>} */
async function boot() {
  const params = new URLSearchParams(location.search);
  const mockMode = params.get('mock') === '1';
  const persona = params.get('asUser') ?? 'reviewer';

  /** @type {import('./sharepoint-client.js').SharePointClient} */
  let client;

  if (mockMode) {
    const [{ MockSharePointClient }, { cases }, { questionDefinitions }, { personas }] = await Promise.all([
      import('./mock-sharepoint-client.js'),
      import('../dev/fixtures/cases.js'),
      import('../dev/fixtures/question-definitions.js'),
      import('../dev/fixtures/personas.js'),
    ]);
    client = new MockSharePointClient({ cases, questionDefinitions, personas, persona });
  } else {
    const { HttpSharePointClient } = await import('./http-sharepoint-client.js');
    client = new HttpSharePointClient();
  }

  // Router registration and view wiring — added in issue #9 (tracer bullet).
  console.log('[RALPH] Case Review Framework booted', { mockMode, persona, client });
}

boot().catch(err => console.error('[RALPH] Boot error:', err));
