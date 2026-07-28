// @ts-check
import { registerStoreRoute } from '../core/store-route.js';
import { redirectTo } from '../lib/navigate.js';

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
 * @property {() => Promise<any>} load
 *   Dynamic `import()` of the page module. A thunk, so the page is fetched on
 *   first navigation and the boot graph never statically depends on it — a
 *   broken page file cannot then break startup or a sibling route.
 * @property {() => boolean} [guard]
 *   Runs before `load` on every mount. Returning false skips the mount, so an
 *   ineligible user never pays for the page module.
 */

/**
 * THE route table: every hash the app answers, and the page behind it.
 *
 * This is deliberately one list rather than a module per route. A route is a
 * path and a lazy page import — there is nothing per-route to hold a file, and
 * ten files holding one line each meant ten hops to answer "what pages exist?".
 * Uniformity used to be a contract test policing `src/routes/*`; here it is
 * structural, because a table entry has only one possible shape.
 *
 * Page modules are still reached only through `import()` thunks, so
 * `tests/component-layering-contract.test.js` and page independence are
 * unchanged: deleting a page is still deleting its file, its entry here, and its
 * nav link.
 *
 * @param {AppContext} context
 * @returns {Record<string, RouteEntry>} keyed by route name, for the log message
 *   on a registration failure and for tests naming a single route
 */
export function routeTable(context) {
  return {
    root: { paths: ['#/'], load: () => import('../pages/home.js') },
    dashboard: {
      paths: ['#/dashboard'],
      load: () => import('../pages/cora-dashboard.js'),
    },
    conversation: {
      paths: ['#/conversation/:caseType/:id', '#/conversation/:id'],
      load: () => import('../pages/cora-conversation-view.js'),
    },
    'question-bank': {
      paths: ['#/question-bank'],
      // The one page the dev/mock harness swaps out, via AppContext.
      load: /** @type {any} */ (
        context.loadQuestionBankEditor ??
          (() => import('../pages/question-bank/cora-bank-editor.js'))
      ),
    },
    case: {
      paths: ['#/case/:caseType/:id', '#/case/:id'],
      load: () => import('../pages/cora-case-review.js'),
    },
    'team-cases': {
      paths: ['#/team-cases'],
      load: () => import('../pages/cora-team-cases.js'),
    },
    'my-cases': {
      paths: ['#/my-cases'],
      load: () => import('../pages/cora-responsible-party-dashboard.js'),
    },
    'journey-cases': {
      paths: ['#/journey-cases'],
      load: () => import('../pages/cora-journey-cases.js'),
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
      load: () => import('../pages/roadmap.js'),
    },
    'my-team': {
      paths: ['#/my-team'],
      load: () => import('../pages/cora-my-team.js'),
    },
  };
}

/**
 * Register every route. One route failing to register costs only its own route,
 * not the whole app — though with `load` a thunk there is nothing left in an
 * entry that can throw here.
 *
 * @param {import('../lib/router.js').Router} router
 * @param {AppContext} context
 */
export function registerRoutes(router, context) {
  for (const [name, entry] of Object.entries(routeTable(context))) {
    try {
      registerStoreRoute(router, { ...entry, context });
    } catch (err) {
      console.error(`[CORA] route registration failed: ${name}`, err);
    }
  }
}
