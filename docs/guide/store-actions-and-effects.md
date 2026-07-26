# Store, actions, and effects

Every application route owns one store and one app-state object. State follows
the same shape: route state under
`routes`, plus the shared `chrome` state created once at boot by
`createChromeState()` for toasts, navigation, and the current user's identity
and permissions:

```js
{
  routes: { reports: {} },
  chrome: {
    toasts: [],
    nav: { currentHash: '#/reports' },
    currentUser: null,
    permissions: {}
  }
}
```

Do not duplicate chrome values inside route slices. Pass already-resolved Case
sources through `AppContext` and store them under the owning route only when
that route consumes them; a page must not rerun Case Type eligibility rules.

`chrome` is a boot-owned shared reference. Route
reducers do not replace or mutate it; named helpers in `core/chrome-state.js`
perform shared writes, and an affected route effect dispatches after the write
when its view needs to render the change. Application pages do not read parallel
copies from `AppContext.currentUser` or `AppContext.capabilities`.

Actions use `domain/event` names such as `query/changed` or `case/saved`.
`dispatch(action)` runs the reducer synchronously. Rendering happens in a
microtask and is coalesced: multiple dispatches in the same turn cause one
render with the latest state.

## Writing a reducer branch

A branch that changes route state uses `patchRoute` from `core/route-state.js`
rather than spelling the `{ ...state, routes: { name: { ...route, … } } }` nest
by hand. It preserves `chrome`, sibling routes, and every sibling field of the
patched route, so a forgotten spread cannot silently drop state:

```js
if (action.type === 'cases/loaded') {
  return patchRoute(state, 'dashboard', { reviewerCases: action.cases });
}
```

The Case Review page's third level has `patchSnapshot(state, patch)`, which
patches `routes.caseReview.snapshot` and returns the same state when no
snapshot is loaded.

These are plain functions a reducer calls — not middleware, not a
`createSlice`-style framework, and not a mutable or proxy draft. Two branch
kinds keep their hand-written shape:

- **Identity-returning guards.** When nothing changed, `return state` — the same
  object reference is what stops a re-render. `patchRoute` always allocates, so
  a guard converted to a patch becomes a re-render storm that no unit test sees.
  Assert these with `assert.strictEqual(reducer(state, action), state)`.
- **Sub-reducer delegation.** A slice reducer that signals "nothing changed" by
  returning its input is compared by reference; relay that identity, and patch
  only inside the changed branch.

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
to `registerStoreRoute(router, { paths, load, context })`, which builds the
standard `createStoreRoute({ load, context })` adapter. That adapter creates the
route-local store and memo cache, renders the view through `morph()`, and
returns the existing Router `{ mount, unmount }` handler shape.

Use the adapter's `listen(target, type, listener)` tool inside the route effect
for external listeners. The adapter removes every registered listener before
disposing the route effect, store, and memo cache on navigation. Do not call
`addEventListener()` directly in a view.

## The mount lifetime

The adapter owns the mount lifetime and exposes it on `tools`. `isActive()`
returns `true` until the slice is unmounted. Guard any dispatch that resumes
after an `await` or a `.then()`:

```js
start(tools) {
  void fetchCases(tools.context.client).then((cases) => {
    if (tools.isActive()) tools.dispatch({ type: 'cases/loaded', cases });
  });
}
```

Do not hand-roll a `let active = true` latch and a teardown that flips it; that
is the same lifetime reimplemented, and forgetting it dispatches into a disposed
store.

`tools` also carries `signal`, the same lifetime in `AbortSignal` form. It is
**reserved, not yet honoured**: `SharePointClient` takes no `AbortSignal`
(#545), so passing it to a request today aborts nothing and the request runs to
completion. Use `isActive()` until #545 lands.
