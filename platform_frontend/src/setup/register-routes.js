// @ts-check
import { registerStoreRoute } from '../core/store-route.js';
import { redirectTo } from '../lib/navigate.js';
import { APP_CONFIG } from '../app-config.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

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
 * nothing here names a page module. Every predicate takes `Capabilities` and
 * nothing wider, which is what lets the nav reuse a route's own `guard` instead
 * of restating it — two declarations of one fact is the duplication the Section
 * epic spent twelve PRs removing.
 *
 * Every entry carries a `page` **or** a `load`, never neither and never both.
 * A typedef cannot say "exactly one of", so a test over
 * `APP_CONFIG.pagePlugins` says it instead.
 *
 * @typedef {Object} PagePlugin
 * @property {string} id
 *   The route's name, used for the log line on a registration failure and by
 *   tests naming a single route.
 * @property {string[]} paths
 *   The hash patterns this route answers, e.g. `['#/case/:caseType/:id']`.
 *   `paths[0]` is the one a nav item and a landing rule link to.
 * @property {any} [page]
 *   The imported page module. The default, and what every route but one has.
 * @property {() => Promise<any>} [load]
 *   A thunk that fetches the page module on first navigation, for a page that
 *   has earned the exception: large enough to be worth a round trip, rarely
 *   enough opened that most sessions never pay for it, and swappable by the
 *   dev harness. One page is.
 * @property {(context: AppContext) => (() => Promise<any>) | undefined} [loadOverride]
 *   The host's substitute loader for this page, read off the boot context. It
 *   is how the dev/mock harness swaps a page, and it is a function rather than
 *   a key name so a mistyped seam is a `tsc` error rather than silence.
 * @property {(capabilities: Capabilities) => boolean} [guard]
 *   Whether this user may open the route. A **pure predicate**: the bounce that
 *   follows a `false` is the engine's, not the page's, precisely so the nav can
 *   ask the same question without redirecting anybody. Absent means open to
 *   anyone with the URL.
 * @property {{
 *   label: string,
 *   order: number,
 *   isVisible?: (capabilities: Capabilities) => boolean
 * }} [nav]
 *   This page's item in the nav bar, if it has one. `order` sorts the bar and
 *   nothing else. `isVisible` defaults to the route's own `guard`, so most
 *   pages state their audience once; write it out only where nav visibility
 *   genuinely differs from route access, and say why where you do.
 * @property {(capabilities: Capabilities) => boolean} [defaultFor]
 *   Whether this page is where a user with these capabilities lands when no
 *   route is asked for.
 * @property {number} [defaultForOrder]
 *   Required wherever `defaultFor` is present: the rank that settles a user
 *   two rules both match. Two rules at the same rank throw rather than pick.
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
 * Where a user lands when no rule claims them.
 *
 * `#/` rather than `#/dashboard`: an unmatched viewer is by definition someone
 * the rules did not recognise, and `pages/home.js` already branches on
 * `isVisitor` to render the guidance screen written for exactly that person.
 */
export const FALLBACK_LANDING_PATH = '#/';

/**
 * The path a user with these capabilities lands on.
 *
 * Rank, not list order. A landing page that fell out of `nav.order` would be a
 * side effect of a number chosen for left-to-right sorting, so reordering the
 * bar would silently move where unmatched users land; and first-match-wins
 * hides precedence inside whichever predicate happens to be earlier, which is
 * how the Section epic shipped two access bugs. Two rules at the same rank is a
 * mistake in the list, so it throws rather than picking one.
 *
 * @param {Capabilities} capabilities
 * @returns {string}
 */
export function resolveDefaultLandingPath(capabilities) {
  const matches = APP_CONFIG.pagePlugins
    .filter((plugin) => plugin.defaultFor?.(capabilities))
    .sort((a, b) => (a.defaultForOrder ?? 0) - (b.defaultForOrder ?? 0));

  if (
    matches.length > 1 &&
    matches[0].defaultForOrder === matches[1].defaultForOrder
  ) {
    throw new Error(
      `ambiguous landing: ${matches.map((match) => match.id).join(', ')}`
    );
  }
  return matches[0]?.paths[0] ?? FALLBACK_LANDING_PATH;
}

/**
 * Bounce a user this route is not for, and say the mount must not happen.
 *
 * Replaces the history entry rather than pushing one, so Back does not return
 * the user to the route that just bounced them. It lives here rather than in
 * the composition root because redirecting is what the ENGINE does with a
 * `false`; a `guard` that redirected could not be reused to decide whether to
 * draw a nav item.
 *
 * @returns {false}
 */
function bounceHome() {
  redirectTo(FALLBACK_LANDING_PATH);
  return false;
}

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
          guard: guard
            ? () => guard(context.chrome.permissions) || bounceHome()
            : undefined,
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
