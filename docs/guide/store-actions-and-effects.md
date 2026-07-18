# Store, actions, and effects

Each converted route owns one store and one app-state object. State has one
slice per route, plus shared `chrome` state for toasts, the command palette,
and the current user's identity and permissions:

```js
{
  routes: { reports: {}, caseReview: {} },
  chrome: { toasts: [], palette: {}, currentUser: null, permissions: [] }
}
```

Actions use `domain/event` names such as `query/changed` or `case/saved`.
`dispatch(action)` runs the reducer synchronously. Rendering happens in a
microtask and is coalesced: multiple dispatches in the same turn cause one
render with the latest state.

Views are pure synchronous functions: state in, DOM tree out, callbacks dispatch
actions back. **Views never await.** They do not import `SaveQueue` or a
`SharePointClient`, make requests, debounce work, or write state directly.

Async work lives in action modules under `src/actions/`. An effect may call the
client, enqueue a write through the existing `SaveQueue`, and await completion.
Its only route back into application state is another dispatch. `SaveQueue`
continues to own ADR-0008 debounce, retry, and ETag concurrency behaviour; the
store does not duplicate or replace any of it.

## Store-driven route modules

A converted page exports `createRouteSlice(params, context)`. The factory
returns the route's initial state, reducer, and pure view. It may also return a
`start(tools)` route effect for edge wiring such as browser events or starting
an action module; lifecycle work does not belong in the view.

The route stays responsible for its lazy dynamic import and passes that loader
to `createStoreRoute({ load, context })`. The standard adapter creates the
route-local store and memo cache, renders the view through `morph()`, and
returns the existing Router `{ mount, unmount }` handler shape.

Use the adapter's `listen(target, type, listener)` tool inside the route effect
for external listeners. The adapter removes every registered listener before
disposing the route effect, store, and memo cache on navigation. Do not call
`addEventListener()` directly in a view.
