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

When a sub-reducer returns the **complete next slice** rather than a patch, use
`setRoute(state, name, slice)` instead. It discards the previous slice rather
than spreading it underneath, so a key the sub-reducer dropped stays dropped —
`patchRoute` would silently resurrect it. The Responsible Party dashboard and
the Question Bank editor are the two call sites:

```js
const next = questionBankReducer(current, action);
if (next === current) return state;
return setRoute(state, 'questionBank', next);
```

Reach for `patchRoute` when your branch names the fields it changes, and
`setRoute` when something else has already produced the whole slice. Picking
the wrong one is a silent data bug, not a type error, in the one direction that
matters: `patchRoute` over a replacement slice resurrects deleted keys.

These are plain functions a reducer calls — not middleware, not a
`createSlice`-style framework, and not a mutable or proxy draft. Two branch
kinds keep their hand-written shape:

- **Identity-returning guards.** When nothing changed, `return state` — the same
  object reference is what stops a re-render. `patchRoute` always allocates, so
  a guard converted to a patch becomes a re-render storm that no unit test sees.
  Assert these with `assert.strictEqual(reducer(state, action), state)`.
- **Sub-reducer delegation.** A slice reducer that signals "nothing changed" by
  returning its input is compared by reference; relay that identity. Then
  `patchRoute` only inside the changed branch if you are naming fields, or
  `setRoute` if the sub-reducer handed you the whole slice.

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
route-local store and memo cache, commits the view through `render()`, and
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

`tools` also carries `signal`, the same lifetime in `AbortSignal` form, and it
is honoured (#545). Bind it to the client's reads once, at the top of the
effect:

```js
import { ignoreAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';

start(tools) {
  const client = withAbortSignal(tools.context.client, tools.signal);
  void fetchCases(client, tools.context.caseSources)
    .then((cases) => {
      if (tools.isActive()) tools.dispatch({ type: 'cases/loaded', cases });
    })
    .catch(ignoreAbortError);
}
```

The two guards are complementary, not alternatives: the signal stops the
**request**, `isActive()` stops the **dispatch**. Keep both.

An aborted read rejects, and that rejection must go no further than the effect
that issued it. `ignoreAbortError` swallows an abort and rethrows anything else,
so navigation never renders a `cora-route-error`, never raises a toast, and
never dispatches a `load-failed`. An effect that already routes failures through
an `isActive()`-guarded rejection handler is covered as it stands — an abort
arrives with the lifetime already over.

`withAbortSignal` binds **reads only** (`getCase`, `listCases`, `countCases`).
Writes are deliberately excluded: a queued edit must survive the user moving on,
which is what the 1500 ms debounce plus ETag concurrency buys. `SaveQueue` holds
the raw client and drops any `signal` passed to `loadCase`, so handing an effect's
read options straight to the queue is safe.

Bind only where there is a client to bind. A route can be mounted with no
client at all, and pages already guard for that; do the wrap **inside** that
guard, so a client-less mount still degrades the way it used to instead of
failing the route. (`withAbortSignal` also returns a falsy client unchanged, as
a second layer — but the guard is the design.)

**The migration is partial.** #545 bound the signal on the pages that fan out
across Case sources, where cancellation actually pays: the Dashboard, Team
Cases, Journey Cases, My Team, and the Responsible Party dashboard. These still
issue **unsignalled** reads and are follow-up work, not oversights:

| Page                                      | Why it was left                              |
| ----------------------------------------- | -------------------------------------------- |
| `pages/cora-case-review.js`               | single-Case load, entangled with `SaveQueue` |
| `pages/cora-conversation-view.js`         | single-Case load                             |
| `pages/roadmap.js`                        | `listRoadmapItems()` takes no options bag    |
| `pages/question-bank/cora-bank-editor.js` | sample/bank loads, not Case reads            |

When adding a read to one of those, binding the signal is the improvement, not
a deviation.
