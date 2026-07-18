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
