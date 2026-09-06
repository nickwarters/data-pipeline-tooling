// @ts-check
import { registerStoreRoute } from '../core/store-route.js';
import { APP_CONFIG } from '../app-config.js';

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
 * One page this application answers a hash with.
 *
 * The engine's half of the contract: the composition root writes these, and
 * nothing here names a page module. `guard` and `loadOverride` take the boot
 * context rather than closing over it, so an entry stays a fact about the page
 * rather than a closure that can only be built once boot has run.
 *
 * @typedef {Object} PagePlugin
 * @property {string} id
 *   The route's name, used for the log line on a registration failure and by
 *   tests naming a single route.
 * @property {string[]} paths
 *   The hash patterns this route answers, e.g. `['#/case/:caseType/:id']`.
 * @property {any} [page]
 *   The imported page module. Set on every route but the Question Bank editor.
 * @property {() => Promise<any>} [load]
 *   A thunk that fetches the page module on first navigation, for the one page
 *   worth the extra round trip.
 * @property {(context: AppContext) => (() => Promise<any>) | undefined} [loadOverride]
 *   The host's substitute loader for this page, read off the boot context. It
 *   is how the dev/mock harness swaps a page, and it is a function rather than
 *   a key name so a mistyped seam is a `tsc` error rather than silence.
 * @property {(context: AppContext) => boolean} [guard]
 *   Runs before the mount on every navigation. Returning false skips the mount,
 *   so no slice, store or effect runs for an ineligible user.
 */

/**
 * One route, as the router adapter takes it.
 *
 * @typedef {Object} RouteEntry
 * @property {string[]} paths
 * @property {any} [page]
 * @property {() => Promise<any>} [load]
 * @property {() => boolean} [guard]
 */

/**
 * THE route table, resolved against the boot context.
 *
 * The list itself lives in `src/app-config.js`, which is the one file that
 * names a page module — so "what pages exist?" still has exactly one answer,
 * and deleting a page is still deleting its file, its entry there, and its nav
 * link. What this function does is bind each entry to the context boot built:
 * a guard becomes a closure the router can call with no arguments, and the
 * Question Bank's loader becomes whichever of the host's substitute and the
 * page's own thunk applies.
 *
 * A page is part of the boot graph, so a page that throws while being evaluated
 * is fatal to boot — which is why the verify gate evaluates every one of them
 * in Node before a browser ever does. Everything that contains a failure at
 * runtime is untouched: the router's error boundary, the navigation sequence
 * token, and the per-entry catch below.
 *
 * @param {AppContext} context
 * @returns {Record<string, RouteEntry>} keyed by route name
 */
export function routeTable(context) {
  return Object.fromEntries(
    APP_CONFIG.pagePlugins.map((plugin) => {
      const { guard, loadOverride } = plugin;
      return [
        plugin.id,
        {
          paths: [...plugin.paths],
          page: plugin.page,
          load: loadOverride?.(context) ?? plugin.load,
          guard: guard ? () => guard(context) : undefined,
        },
      ];
    })
  );
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
