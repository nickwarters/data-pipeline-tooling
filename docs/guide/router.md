# Router Integration

A route is a plain `register(router, context)` function that composes **function
components** — plain functions returning `h()` nodes — and mounts them with
`container.replaceChildren(…)`. Routes do not create a custom element per screen;
custom elements are reserved for route/browser-integration shells.

## Quick reference

```js
// src/routes/my-page.js
import { MyPage } from '../pages/my-page.js';

export function register(router, context) {
  router.register('#/my-page/:id', {
    //:id → dynamic segment
    mount(container, { id }) {
      // called when hash matches
      container.replaceChildren(MyPage({ client: context.client, caseId: id }));
    },
    unmount() {}, // called before the next route mounts
  });
}
```

Then add one line to `src/setup/register-routes.js`:

```js
import { register as registerMyPage } from '../routes/my-page.js';
// …
registerMyPage(router, context);
```

---

## How the router works

The `Router` class (`src/lib/router.js`) is a plain hash router. It listens for `hashchange` events on `window` and matches `location.hash` against registered patterns. When a match is found it calls `unmount()` on the previous route and `mount(container, params)` on the new one.

Pattern segments starting with `:` become string keys in the `params` object:

| Pattern       | Hash          | `params`       |
| ------------- | ------------- | -------------- |
| `#/dashboard` | `#/dashboard` | `{}`           |
| `#/case/:id`  | `#/case/42`   | `{ id: '42' }` |

The router is created once in `app.js` and passed (via `AppContext`) to every route registration function.

---

## Adding a new route — step by step

1. **Create the route file** `src/routes/my-page.js` with an exported `register` function (see Quick reference above).

2. **Create the page function** under `src/pages/` if the route needs a dedicated view (see [Component authoring](component-authoring.md)).

3. **Import what the route uses** — import the page function directly. Import a custom-element shell module only for a genuine route/browser-integration boundary, never as the default way to mount a screen.

4. **Register the route** — import and call your `register` function in `src/setup/register-routes.js`.

5. **Write tests** — test the route's `mount` function directly (see [Testing](testing.md)).

---

## `mount` and `unmount` lifecycle

`mount(container, params)` is called every time the user navigates to your route. Build the component tree and call `container.replaceChildren(…)` to render it. This replaces whatever was there before — you don't need to clean up the previous route's DOM yourself.

`unmount()` is called just before the next route mounts. You rarely need to do
anything here. Use `unmount` only for teardown that cannot be owned by
`reactive()` lifecycle helpers or removed with `replaceChildren()`.

---

## AppContext

Every route handler receives the same `AppContext` object:

```js
/**
 * @typedef {Object} AppContext
 * @property {import('../sharepoint-client.js').SharePointClient} client
 * @property {import('../services/save-queue.js').SaveQueue} saveQueue
 * @property {import('../sharepoint-client.js').CurrentUser} currentUser
 * @property {import('../services/permissions.js').Capabilities} capabilities
 * @property {Element} appEl
 */
```

Pass the relevant slices down to components as properties. Don't pass the entire context object to a component — it creates an implicit dependency on everything.

---

## Worked example: `#/my-cases` route

```js
// src/routes/my-cases.js
// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/my-cases', {
    mount(container) {
      container.replaceChildren(
        MyCasesPage({
          client: context.client,
          currentUserId: context.currentUser.id,
        })
      );
    },
    unmount() {},
  });
}
```
