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

  const { Router } = await import('./router.js');
  const { SaveQueue } = await import('./save-queue.js');
  const { resolveCapabilities } = await import('./permissions.js');
  const { registerComponents } = await import('./register-components.js');
  await registerComponents();

  const saveQueue = new SaveQueue(client);
  const router = new Router();
  const [currentUser, userGroups] = await Promise.all([
    client.getCurrentUser(),
    client.getCurrentUserGroups(),
  ]);
  const capabilities = resolveCapabilities(userGroups);

  const { default: helloReviewConfig } = await import('../case-types/hello-review.js');
  /** @type {string[]} */
  const eligibleCaseTypes = [];
  if (helloReviewConfig.eligibleGroups?.some(g => userGroups.includes(g))) {
    eligibleCaseTypes.push('hello-review');
  }

  const appEl = /** @type {Element} */ (document.getElementById('app'));
  appEl.setAttribute('data-cr-root', '');

  const { registerRoutes } = await import('./register-routes.js');
  registerRoutes(router, { client, saveQueue, currentUser, capabilities, eligibleCaseTypes, appEl });

  router.init(appEl);
}

boot().catch(err => console.error('[RALPH] Boot error:', err));
