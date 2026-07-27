# Router integration

A route exports `register(router, context, loadPage)`, lazy-loads one page
module, and hands that loader to `registerStoreRoute()`. This keeps page code
out of the boot graph and gives every page the same store, render, error, and
cleanup contract.

## Quick reference

```js
// src/routes/my-page.js
import { registerStoreRoute } from '../core/store-route.js';

export function register(
  router,
  context,
  loadPage = () => import('../pages/my-page.js')
) {
  registerStoreRoute(router, {
    paths: ['#/my-page/:id'],
    load: loadPage,
    context,
  });
}
```

`registerStoreRoute(router, { paths, load, context, guard })` creates the
`createStoreRoute()` adapter once and registers it on every pattern in `paths`
— that is how `#/case/:caseType/:id` and `#/case/:id` share one handler. The
optional `guard: () => boolean` runs on each mount, before the page is
imported; returning `false` skips the mount, which is how `#/journey-cases`
bounces an ineligible user without loading the page. The `loadPage` default
parameter is the seam every `tests/routes-*.test.js` injects through, so keep
it.

The dynamic `import()` stays in the route module; the helper never names a
page. Every route in `src/routes/` now goes through `registerStoreRoute` — a
route module no longer needs a `mount`/`unmount` literal to see the query
string, because the router supplies it (see below).

Then register the route in `src/setup/register-routes.js`:

```js
import { register as registerMyPage } from '../routes/my-page.js';

safeRegister('my-page', registerMyPage, router, context);
```

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

`safeRegister(...)` independently contains registration failures. A broken
route therefore cannot prevent sibling routes or persistent navigation from
working.

## Adding a route

1. Add `src/pages/my-page.js` with `createRouteSlice(params, context)`. Follow
   [Add a store-driven page](add-a-page.md).
2. Add `src/routes/my-page.js` using the quick-reference pattern above.
3. Import and register the route through `safeRegister(...)` in
   `src/setup/register-routes.js`.
4. Add a navigation link only if the page belongs in persistent navigation.
5. Test the page's public view/reducer behaviour, route registration, parameter
   forwarding, and lazy-load failure boundary. See [Testing](testing.md).

Removing a page is the reverse: remove its page file, route file,
`safeRegister(...)` call, and navigation link.

## Mount and unmount ownership

`createStoreRoute()`:

- calls the page's `createRouteSlice(params, context)`;
- creates the route-local store and memo cache;
- renders a `view(state, tools)` through `morph()`, or calls the slice's custom
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
