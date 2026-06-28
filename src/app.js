// @ts-check
// TODO(simplify-ui): Collapse bootstrapping around the function-component
// model. The app shell should wire shared services/signals once, register only
// route or browser-integration shells, and avoid ordinary custom-element
// registration as the default rendering path.

/** @returns {Promise<void>} */
async function boot() {
  await Promise.all([
    import('./components/cr-app-nav.js'),
    import('./components/cr-command-palette.js'),
    import('./pages/cr-dashboard.js'),
    import('./pages/cr-case-review.js'),
    import('./pages/cr-conversation-view.js'),
    import('./pages/cr-reports-index.js'),
    import('./pages/cr-reviewer-team-report.js'),
    import('./pages/cr-responsible-party-dashboard.js'),
    import('./pages/cr-team-cases.js'),
    import('./question-bank/cr-bank-editor.js'),
  ]);

  const { createSharePointClient } =
    await import('./services/create-sharepoint-client.js');
  const client = await createSharePointClient(
    new URLSearchParams(location.search)
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

  const { resolveEligibleCaseTypes } =
    await import('./setup/resolve-eligible-case-types.js');
  const eligibleCaseTypes = await resolveEligibleCaseTypes(userGroups);

  const appEl = /** @type {Element} */ (document.getElementById('app'));
  appEl.setAttribute('data-cr-root', '');

  const nav = /** @type {import('./components/cr-app-nav.js').CRAppNav} */ (
    document.createElement('cr-app-nav')
  );
  nav.capabilities = capabilities;
  appEl.appendChild(nav);
  document.body.appendChild(document.createElement('cr-command-palette'));

  const routerContainer = document.createElement('div');
  routerContainer.className = 'cr-page-content';
  appEl.appendChild(routerContainer);

  const { registerRoutes } = await import('./setup/register-routes.js');
  registerRoutes(router, {
    client,
    saveQueue,
    currentUser,
    capabilities,
    eligibleCaseTypes,
    appEl,
  });

  router.init(routerContainer);
}

boot().catch((err) => console.error('[RALPH] Boot error:', err));
