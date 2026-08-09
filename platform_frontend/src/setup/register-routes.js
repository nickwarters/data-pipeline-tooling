// @ts-check
import { registerStoreRoute } from '../core/store-route.js';
import { redirectTo } from '../lib/navigate.js';

import * as homePage from '../pages/home.js';
import * as dashboardPage from '../pages/cora-dashboard.js';
import * as myStatsPage from '../pages/cora-my-stats.js';
import * as teamStatsPage from '../pages/cora-team-stats.js';
import * as conversationPage from '../pages/cora-conversation-view.js';
import * as caseReviewPage from '../pages/cora-case-review.js';
import * as teamCasesPage from '../pages/cora-team-cases.js';
import * as responsiblePartyPage from '../pages/cora-responsible-party-dashboard.js';
import * as journeyCasesPage from '../pages/cora-journey-cases.js';
import * as roadmapPage from '../pages/roadmap.js';
import * as myTeamPage from '../pages/cora-my-team.js';
import * as caseSearchPage from '../pages/cora-case-search.js';

/**
 * @typedef {Object} AppContext
 * @property {import('../sharepoint-client.js').SharePointClient} client
 * @property {import('../services/save-queue.js').SaveQueue} saveQueue
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {import('./resolve-eligible-case-types.js').CaseSource[]} caseSources
 * @property {import('./resolve-eligible-case-types.js').CaseSource[]} journeyCaseSources
 * @property {import('./resolve-eligible-case-types.js').AllocationSource[]} allocationSources
 * @property {Element} appEl
 * @property {() => Promise<unknown>} [loadQuestionBankEditor]
 * @property {() => Promise<unknown>} [loadQuestionBankSamples]
 * @property {(artifacts: ReturnType<import('../pages/question-bank/question-bank-compile.js').buildPublishArtifacts>) => Promise<void>} [writeQuestionBankArtifacts]
 */

/**
 * One route.
 *
 * @typedef {Object} RouteEntry
 * @property {string[]} paths
 *   The hash patterns this route answers, e.g. `['#/case/:caseType/:id']`.
 * @property {any} [page]
 *   The imported page module. Set on every route but the Question Bank editor.
 * @property {() => Promise<any>} [load]
 *   A thunk that fetches the page module on first navigation, for the one page
 *   worth the extra round trip.
 * @property {() => boolean} [guard]
 *   Runs before the mount on every navigation. Returning false skips the mount,
 *   so no slice, store or effect runs for an ineligible user.
 */

/**
 * THE route table: every hash the app answers, and the page behind it.
 *
 * This is deliberately one list rather than a module per route. A route is a
 * path and a page — there is nothing per-route to hold a file, and ten files
 * holding one line each meant ten hops to answer "what pages exist?".
 * Uniformity used to be a contract test policing `src/routes/*`; here it is
 * structural, because a table entry has only one possible shape.
 *
 * This file is still the only place that names a page module, so
 * `tests/component-layering-contract.test.js` and page independence hold:
 * deleting a page is deleting its file, its entry here, and its nav link. What
 * changed is that most entries hold the module itself rather than a thunk that
 * fetches it. A page is now part of the boot graph, so a page that throws while
 * being evaluated is fatal to boot — which is why the verify gate evaluates
 * every one of them in Node before a browser ever does. Everything that
 * contains a failure at runtime is untouched: the router's error boundary, the
 * navigation sequence token, and the per-entry catch below.
 *
 * @param {AppContext} context
 * @returns {Record<string, RouteEntry>} keyed by route name, for the log message
 *   on a registration failure and for tests naming a single route
 */
export function routeTable(context) {
  return {
    root: { paths: ['#/'], page: homePage },
    dashboard: {
      paths: ['#/dashboard'],
      page: dashboardPage,
    },
    'my-stats': {
      paths: ['#/my-stats'],
      page: myStatsPage,
      guard: () => {
        if (context.chrome.permissions.isReviewer) return true;
        redirectTo('#/');
        return false;
      },
    },
    'team-stats': {
      paths: ['#/team-stats'],
      page: teamStatsPage,
      guard: () => {
        if (context.chrome.permissions.isReviewerManager) return true;
        redirectTo('#/');
        return false;
      },
    },
    conversation: {
      paths: ['#/conversation/:caseType/:id', '#/conversation/:id'],
      page: conversationPage,
    },
    'question-bank': {
      paths: ['#/question-bank'],
      // The one page still fetched on demand. It is the largest subsystem in
      // the app, only a Maintainer ever opens it, so most sessions never pay
      // for it — and the thunk is the seam the dev/mock harness swaps out via
      // AppContext, which a static import could not offer.
      load: /** @type {any} */ (
        context.loadQuestionBankEditor ??
          (() => import('../pages/question-bank/cora-bank-editor.js'))
      ),
    },
    case: {
      paths: ['#/case/:caseType/:id', '#/case/:id'],
      page: caseReviewPage,
    },
    'team-cases': {
      paths: ['#/team-cases'],
      page: teamCasesPage,
    },
    'my-cases': {
      paths: ['#/my-cases'],
      page: responsiblePartyPage,
    },
    'journey-cases': {
      paths: ['#/journey-cases'],
      page: journeyCasesPage,
      // List-scope Journey Owner capability: only a user who owns at least one
      // Case Type as a Journey Owner may see this view. The bounce replaces
      // rather than pushes, so Back does not return the user to the route that
      // just bounced them.
      guard: () => {
        if (context.journeyCaseSources.length > 0) return true;
        redirectTo('#/');
        return false;
      },
    },
    roadmap: {
      paths: ['#/roadmap'],
      page: roadmapPage,
    },
    'my-team': {
      paths: ['#/my-team'],
      page: myTeamPage,
    },
    search: {
      paths: ['#/search'],
      page: caseSearchPage,
      // Cross-Case-Type lookup is a capability, not a page: the mapping from
      // groups to it lives in one place, so widening it never touches a route.
      // The bounce replaces rather than pushes, so Back does not return the
      // user to the route that just bounced them.
      guard: () => {
        if (context.chrome.permissions.canSearchCases) return true;
        redirectTo('#/');
        return false;
      },
    },
  };
}

/**
 * Register every route. One route failing to register costs only its own route,
 * not the whole app — though an entry is a paths array and a module reference,
 * so there is little left in one that can throw at this point.
 *
 * @param {import('../lib/router.js').Router} router
 * @param {AppContext} context
 */
export function registerRoutes(router, context) {
  /** @type {Array<[string, RouteEntry]>} */
  let entries;
  try {
    entries = Object.entries(routeTable(context));
  } catch (err) {
    // Building the table reads `context` and allocates object literals, so
    // nothing in it can realistically throw — but if it ever does, that is the
    // one failure that costs every route, which makes it the one worth naming.
    console.error('[CORA] route table could not be built', err);
    return;
  }
  for (const [name, entry] of entries) {
    try {
      registerStoreRoute(router, { ...entry, context });
    } catch (err) {
      console.error(`[CORA] route registration failed: ${name}`, err);
    }
  }
}
