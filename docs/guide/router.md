# Router integration

A route is one entry in the route table in `src/setup/register-routes.js`: the
hash patterns it answers, and an `import()` thunk for its page. This keeps page
code out of the boot graph and gives every page the same store, render, error,
and cleanup contract.

## Quick reference

```js
// src/setup/register-routes.js, inside routeTable(context)
'my-page': {
  paths: ['#/my-page/:id'],
  load: () => import('../pages/my-page.js'),
},
```

`registerStoreRoute(router, { paths, load, context, guard })` creates the
`createStoreRoute()` adapter once and registers it on every pattern in `paths`
— that is how `#/case/:caseType/:id` and `#/case/:id` share one handler. The
optional `guard: () => boolean` runs on each mount, before the page is
imported; returning `false` skips the mount, which is how `#/journey-cases`
bounces an ineligible user without loading the page.

`registerRoutes()` walks the table and registers each entry. Because an entry's
`load` is a thunk, nothing in it runs at registration — a page's own code cannot
break the boot, and it is imported on first navigation to it.

## How the router works

`Router` in `src/lib/router.js` listens for `hashchange`, matches the hash
against registered patterns, unmounts the current handler, and mounts the next
one. A segment beginning with `:` becomes a string in the `params` object.

The router splits the query string off the hash to match the path, so it hands
that raw query string back as `params.queryString` — always present, `''` when
the hash has no query. It stays a raw string (leading `?` included): the page
owns what its parameters mean, so `#/team-cases` reads it through
`parseTeamCasesParams()` in `src/services/team-cases-params.js`.

| Pattern         | Hash               | `params`                        |
| --------------- | ------------------ | ------------------------------- |
| `#/dashboard`   | `#/dashboard`      | `{ queryString: '' }`           |
| `#/my-page/:id` | `#/my-page/42`     | `{ id: '42', queryString: '' }` |
| `#/team-cases`  | `#/team-cases?a=1` | `{ queryString: '?a=1' }`       |

`queryString` is reserved. It is assigned after the `:param` extraction, so a
pattern declaring `:queryString` would have its path param silently overwritten
— name the segment something else.

Every page import stays inside its route's `load` callback. The router contains
load failures inside the route container, and a navigation sequence prevents a
slow prior import from mounting after the user has moved elsewhere.

`registerRoutes()` catches per entry, so one route failing to register cannot
prevent sibling routes or persistent navigation from working.

## Adding a route

1. Add `src/pages/my-page.js` with `createRouteSlice(params, context)`. Follow
   [Add a store-driven page](add-a-page.md).
2. Add an entry to `routeTable()` in `src/setup/register-routes.js` using the
   quick-reference pattern above.
3. Add a navigation link only if the page belongs in persistent navigation.
4. Test the page's public view/reducer behaviour. Registration, parameter
   forwarding and the lazy-load failure boundary belong to `registerStoreRoute`
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

The `#/my-cases` route is intentionally thin:

```js
import { registerStoreRoute } from '../core/store-route.js';

export function register(
  router,
  context,
  loadPage = () => import('../pages/cora-responsible-party-dashboard.js')
) {
  registerStoreRoute(router, {
    paths: ['#/my-cases'],
    load: loadPage,
    context,
  });
}
```

All page-specific state, reduction, view composition, and effects remain in the
page module or focused action modules.
