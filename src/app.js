// @ts-check
// The app shell wires shared services once and eagerly loads only the custom
// elements that are genuine route/browser-integration shells (the nav, command
// palette, and Case Review page). The Question Bank editor is route-loaded
// because it imports every Case Type config to build the editable bank map.
// Ordinary screens are plain function components that their route modules import
// directly, so they need no custom-element registration here.

/** @returns {Promise<void>} */
async function boot() {
  await Promise.all([
    import('./components/sections/cora-app-nav.js'),
    import('./components/sections/cora-command-palette.js'),
    import('./pages/cora-case-review.js'),
  ]);

  const { resolveEnvironment } = await import('./config/environment.js');
  const env = resolveEnvironment();

  const { createSharePointClient } =
    await import('./services/create-sharepoint-client.js');
  const client = await createSharePointClient(
    new URLSearchParams(location.search),
    env
  );

  const { Router } = await import('./lib/router.js');
  const { SaveQueue } = await import('./services/save-queue.js');
  const { resolveCapabilities } = await import('./services/permissions.js');

  const saveQueue = new SaveQueue(client);
  const router = new Router();
  const [currentUser, userGroups] = await Promise.all([
    client.getCurrentUser(),
    client.getCurrentUserGroups(),
  ]);
  const capabilities = resolveCapabilities(userGroups);

  const { resolveAppCaseSources } =
    await import('./setup/resolve-eligible-case-types.js');
  // Every route receives only sources the current user's roles may span.
  // Type-scoped owners get their own types; broad roles (Controls,
  // Reviewer-Managers, Advisers, ResponsibleParty-Managers and Maintainers) get the full
  // manifest. RP surfaces retain their assigned-party query filters.
  const { caseSources, journeyCaseSources } = await resolveAppCaseSources(
    userGroups,
    capabilities.ownedJourneyCaseTypes
  );
  const allocationSources = caseSources.map(({ slug, listName }) => ({
    slug,
    listName,
  }));

  const appEl = /** @type {Element} */ (document.getElementById('app'));
  appEl.setAttribute('data-cora-root', '');

  const { mountUatBanner } = await import('./setup/uat-banner.js');
  mountUatBanner(env, appEl);

  const nav =
    /** @type {import('./components/sections/cora-app-nav.js').CORAAppNav} */ (
      document.createElement('cora-app-nav')
    );
  nav.capabilities = capabilities;
  appEl.appendChild(nav);
  document.body.appendChild(document.createElement('cora-command-palette'));

  const routerContainer = document.createElement('div');
  routerContainer.className = 'cora-page-content';
  appEl.appendChild(routerContainer);

  const { registerRoutes } = await import('./setup/register-routes.js');
  registerRoutes(router, {
    client,
    saveQueue,
    currentUser,
    capabilities,
    caseSources,
    journeyCaseSources,
    allocationSources,
    appEl,
  });

  router.init(routerContainer);
}

boot().catch((err) => console.error('[RALPH] Boot error:', err));
