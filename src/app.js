// @ts-check
// The app shell wires shared services once. Every page loads on demand inside
// its route's `mount()` (see src/routes/*), guarded by the router's error
// boundary (lib/router.js) — a broken page module renders an in-page
// `cora-route-error` panel instead of taking down the app. The nav and command
// palette are mounted here via `setup/app-chrome.js`: a broken nav is
// fatal-with-message (the app is unusable without it), a broken palette is
// logged and skipped. Case Type modules are contained per slug the same way: a
// Case Type that fails to evaluate is dropped from every resolved source set
// and named in a non-blocking banner, and boot continues. That holds in BOTH
// environments — `createSharePointClient` below is awaited first, and under
// `?mock=1` it partitions the fixture Cases by Case Type, so it contains per
// Case Type too rather than throwing ahead of the containment.

/** @returns {Promise<void>} */
async function boot() {
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
  const { bindChromeNavigation, createChromeState } =
    await import('./core/chrome-state.js');
  const chrome = createChromeState({
    currentUser,
    permissions: capabilities,
    currentHash: location.hash || '#/',
  });
  bindChromeNavigation(chrome);

  const { allocationSourcesFromCaseSources, resolveAppCaseSources } =
    await import('./setup/resolve-eligible-case-types.js');
  // Every route receives only sources the current user's roles may span.
  // Type-scoped owners get their own types; broad roles (Controls,
  // Reviewer Managers, Advisers, ResponsibleParty-Managers and Maintainers) get the full
  // manifest. RP surfaces retain their assigned-party query filters.
  // A Case Type module that throws is contained the same way a broken page is:
  // that Case Type is dropped and named in a banner; the app boots.
  const { caseSources, journeyCaseSources, unavailableCaseTypes } =
    await resolveAppCaseSources(userGroups, capabilities.ownedJourneyCaseTypes);
  const allocationSources = allocationSourcesFromCaseSources(caseSources);

  const appEl = /** @type {Element} */ (document.getElementById('app'));
  appEl.setAttribute('data-cora-root', '');

  const { mountUatBanner } = await import('./setup/uat-banner.js');
  mountUatBanner(env, appEl);

  const { mountAppChrome } = await import('./setup/app-chrome.js');
  const ok = await mountAppChrome(appEl, capabilities);
  if (!ok) return;

  // Loaded only when there is something to say, and guarded: in the 100% case
  // there is nothing to mount, and a module that fails to fetch must not kill
  // boot inside the feature whose whole purpose is that boot survives a broken
  // Case Type. The console already carries each underlying error.
  if (unavailableCaseTypes.length) {
    try {
      const { mountCaseTypeUnavailableBanner } =
        await import('./setup/case-type-unavailable-banner.js');
      mountCaseTypeUnavailableBanner(unavailableCaseTypes, appEl);
    } catch (error) {
      console.error('[CORA] Case Type unavailable banner failed:', error);
    }
  }

  const routerContainer = document.createElement('div');
  routerContainer.className = 'cora-page-content';
  appEl.appendChild(routerContainer);

  const { registerRoutes } = await import('./setup/register-routes.js');
  registerRoutes(router, {
    client,
    saveQueue,
    chrome,
    caseSources,
    journeyCaseSources,
    allocationSources,
    appEl,
  });

  router.init(routerContainer);
}

boot().catch((err) => console.error('[RALPH] Boot error:', err));
