// @ts-check

/** @returns {Promise<void>} */
async function boot() {
  const { createSharePointClient } = await import('./create-sharepoint-client.js');
  const client = await createSharePointClient(new URLSearchParams(location.search));

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

  const { resolveEligibleCaseTypes } = await import('./resolve-eligible-case-types.js');
  const eligibleCaseTypes = await resolveEligibleCaseTypes(userGroups);

  const appEl = /** @type {Element} */ (document.getElementById('app'));
  appEl.setAttribute('data-cr-root', '');

  const { registerRoutes } = await import('./register-routes.js');
  registerRoutes(router, { client, saveQueue, currentUser, capabilities, eligibleCaseTypes, appEl });

  router.init(appEl);
}

boot().catch(err => console.error('[RALPH] Boot error:', err));
