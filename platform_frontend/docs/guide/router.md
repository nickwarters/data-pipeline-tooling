# Router integration

A route is one entry in the route table in `src/setup/register-routes.js`: the
hash patterns it answers, and the page module behind them. The table imports its
pages statically and hands each module to the entry's `page` key; only
`#/question-bank` still holds a `load` thunk. Either way every page gets the same
store, render, error and cleanup contract.

## Quick reference

```js
// src/setup/register-routes.js, at the top
import * as myPage from '../pages/my-page.js';

// inside routeTable(context)
'my-page': {
  paths: ['#/my-page/:id'],
  page: myPage,
},
```

`registerStoreRoute(router, { paths, page, context, guard })` creates the
`createStoreRoute()` adapter once and registers it on every pattern in `paths`
— that is how `#/case/:caseType/:id` and `#/case/:id` share one handler. It
takes `page` or `load`, exactly one; passing neither or both is a `TypeError`.
The optional `guard: () => boolean` runs on each mount, before anything else;
returning `false` skips the mount, which is how `#/journey-cases` bounces an
ineligible user. The guard buys the short-circuit, not the download — no slice,
store or effect runs for an ineligible user, but the module is already in memory.

`registerRoutes()` walks the table and registers each entry. An entry is a paths
array and a module reference, so registration itself runs no page code; the
page's `createRouteSlice()` is called on first navigation to it.

The `#/my-stats` route is a static page import guarded by
`context.chrome.permissions.isReviewer`. A user without that capability is
redirected to `#/` before the page slice mounts. This is a UX-only redirect;
SharePoint list permissions remain the access boundary, and
`isReviewerManager` alone does not grant this route.

On mount, the page loads the signed-in Reviewer's Report Feed from the host
web's document library. `?mock=1` selects the development fixture instead. The
route slice also snapshots the browser-local calendar once, deriving its four
range descriptors and default `week` selection without consulting the clock in
the reducer.

The slice tracks the report as `loading`, `loaded` or `failed`, because
`reportFeed: null` alone cannot tell "not fetched yet" from "nothing published".
A loaded report is followed by one second read: the live tail, one bounded
`listCases` call per Case Type list, covering only the days after the report's
`complete_through` and never more than ten calendar days. The unpaged call may
follow pagination links into multiple HTTP requests. No report means no tail
read at all, and the page says a report has not been published yet.

The mount lifetime is bound **once**, in `start()`, with
`withAbortSignal(context.client, tools.signal)`; the tail fetcher below it takes
the wrapped client and knows nothing about cancellation. The Report Feed is not
a client read — it is a document-library `fetch` — and carries the same signal
through its own options bag. An aborted read of either is navigation and
dispatches nothing.

The view derives one report from the feed and the typed live tail, and renders
it three ways: a full-width grouped chart, the headline figures, and a
full-width Case Type count/percentage table beneath them. The four range
controls sit above the chart; they dispatch `my-stats/range-selected` while the
chart and table remain derived rather than delivered. The table uses the
chart's daily or monthly bucket grain. There is no separate `chart` route
field. The route still owns chart tooltip setup and cleanup.

The `#/team-stats` route is also a static page import, guarded solely by
`context.chrome.permissions.isReviewerManager`. A non-manager is redirected to
`#/` before the page slice mounts. This check is UX-only; SharePoint ACLs remain
the security boundary: Case-list ACLs protect live Case data, while the Report
Feed document-library ACL protects the settled-history file.

## How the router works

`Router` in `src/lib/router.js` listens for `hashchange`, matches the hash
against registered patterns, unmounts the current handler, and mounts the next
one. A segment beginning with `:` becomes a string in the `params` object.

The router splits the query string off the hash to match the path, so it hands
that raw query string back as `params.queryString` — always present, `''` when
the hash has no query. It stays a raw string (leading `?` included): the page
owns what its parameters mean, so `#/team-cases` reads its own `caseType` out of
it with `new URLSearchParams(...)` in `src/pages/cora-team-cases.js`.

| Pattern         | Hash               | `params`                        |
| --------------- | ------------------ | ------------------------------- |
| `#/dashboard`   | `#/dashboard`      | `{ queryString: '' }`           |
| `#/my-page/:id` | `#/my-page/42`     | `{ id: '42', queryString: '' }` |
| `#/team-cases`  | `#/team-cases?a=1` | `{ queryString: '?a=1' }`       |

`queryString` is reserved. It is assigned after the `:param` extraction, so a
pattern declaring `:queryString` would have its path param silently overwritten
— name the segment something else.

Every page import stays in the route table. The router contains a mount failure
inside the route container, and a navigation sequence prevents a slow prior
import — the Question Bank editor's, today — from mounting after the user has
moved elsewhere.

`registerRoutes()` catches per entry, so one route failing to register cannot
prevent sibling routes or persistent navigation from working.

## Adding a route

1. Add `src/pages/my-page.js` with `createRouteSlice(params, context)`. Follow
   [Add a store-driven page](add-a-page.md).
2. Import it at the top of `src/setup/register-routes.js` and add an entry to
   `routeTable()` using the quick-reference pattern above.
3. Add a navigation link only if the page belongs in persistent navigation.
4. Test the page's public view/reducer behaviour. Registration, parameter
   forwarding and the mount failure boundary belong to `registerStoreRoute`
   and the router, and are covered once in `tests/register-routes.test.js`,
   `tests/store-route.test.js` and `tests/router.test.js` — not per page. See
   [Testing](testing.md).

Removing a page is the reverse: remove its page file, its table entry, and its
navigation link.

## Mount and unmount ownership

`createStoreRoute()`:

- calls the page's `createRouteSlice(params, context)`;
- creates the route-local store and memo cache;
- commits a `view(state, tools)` through `render()`, or calls the slice's custom
  `render(...)` only where a bounded render surface requires it;
- supplies `dispatch`, `memo`, `params`, `context`, and `listen` tools;
- contains render failures after mount inside the route;
- removes listeners registered with `listen(...)` on navigation;
- calls the cleanup returned by `start(...)`, disposes the store, and clears
  the memo cache.

Views do not own lifecycle work. Register external listeners through
`listen(target, type, listener)` inside the slice's `start(tools)` effect, and
return a cleanup function for any other edge resource.

## AppContext

The current `AppContext` contract is defined in
`src/setup/register-routes.js`. Its important boundaries are:

```js
/**
 * @property {import('../sharepoint-client.js').SharePointClient} client
 * @property {import('../services/save-queue.js').SaveQueue} saveQueue
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {import('../setup/resolve-eligible-case-types.js').CaseSource[]} caseSources
 * @property {Element} appEl
 */
```

Use context to construct initial route state and edge effects. Views read
application values from state, not directly from the context object. Already
resolved Case sources come from context; pages must not re-run eligibility
rules.

## Worked example

The `#/my-cases` route is intentionally thin — an import at the top of the route
table and one entry in it:

```js
import * as responsiblePartyPage from '../pages/cora-responsible-party-dashboard.js';

// inside routeTable(context)
'my-cases': {
  paths: ['#/my-cases'],
  page: responsiblePartyPage,
},
```

All page-specific state, reduction, view composition, and effects remain in the
page module or focused action modules.
