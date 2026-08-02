// @ts-check
// The app shell wires shared services once, then hands over to the router.
//
// Every import below is static: a failure in any of them is fatal to boot
// anyway, so deferring them contained nothing and only made boot a serial
// chain of round trips. The deferrals that DO contain a failure live
// elsewhere and are unchanged.
//
// The honest limit of the boot-error panel: a module in this static graph that
// throws while being evaluated does so BEFORE `boot().catch` exists, so the
// panel cannot cover it. Nothing visible is lost — the old catch only wrote to
// the console — but the panel covers boot's body, not boot's module graph.
// Covering that would take a fallback element in the host page markup that a
// successful boot clears, which is not done here.

import { resolveEnvironment } from './config/environment.js';
import { createSharePointClient } from './services/create-sharepoint-client.js';
import { SaveQueue } from './services/save-queue.js';
import { resolveCapabilities } from './services/permissions.js';
import { createChromeState } from './core/chrome-state.js';
import { Router } from './lib/router.js';
import { renderBootError } from './lib/boot-error-panel.js';
import {
  allocationSourcesFromCaseSources,
  resolveAppCaseSources,
} from './setup/resolve-eligible-case-types.js';
import { mountUatBanner } from './setup/uat-banner.js';
import { mountAppChrome } from './setup/app-chrome.js';
import { mountCaseTypeUnavailableBanner } from './setup/case-type-unavailable-banner.js';
import { registerRoutes } from './setup/register-routes.js';

/** @returns {Promise<void>} */
async function boot() {
  const env = resolveEnvironment();
  const client = await createSharePointClient(
    new URLSearchParams(location.search),
    env
  );

  const saveQueue = new SaveQueue(client);
  const router = new Router();
  const [currentUser, userGroups] = await Promise.all([
    client.getCurrentUser(),
    client.getCurrentUserGroups(),
  ]);
  const capabilities = resolveCapabilities(userGroups);
  const chrome = createChromeState({
    currentUser,
    permissions: capabilities,
  });

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

  mountUatBanner(env, appEl);

  const ok = await mountAppChrome(appEl, capabilities);
  if (!ok) return;

  mountCaseTypeUnavailableBanner(unavailableCaseTypes, appEl);

  const routerContainer = document.createElement('div');
  routerContainer.className = 'cora-page-content';
  appEl.appendChild(routerContainer);

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

boot().catch(renderBootError);
