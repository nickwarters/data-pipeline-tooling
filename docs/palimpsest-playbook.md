# Palimpsest conversion playbook

Use this checklist when converting an existing route from component-owned
state to the store-driven view architecture in ADR-0034. Convert one complete
route at a time and preserve its URL, permissions, data-loading behaviour, and
mock-mode behaviour.

## State slice

Every converted route exports `createRouteSlice(params, context)` and returns
`initialState`, `reducer`, and a pure `view`. Use the common app-state shape:

```js
{
  chrome: context.chrome,
  routes: {
    home: { /* only Home-owned state */ }
  }
}
```

`chrome` is created once at boot by `createChromeState()` and is the defined
home for toasts, navigation state, the current user, and permissions. Do not
copy those values into a route slice. Route-owned state belongs under
`routes.<routeName>`. Pass already-resolved Case sources through `AppContext`;
do not repeat Case Type eligibility logic inside a page.

Views are synchronous and pure: state in, an `h()` tree out. They do not import
the router, store, `SaveQueue`, or a SharePoint client. Effects and external
listeners belong in `start(tools)`; use `tools.listen()` so unmount cleanup is
automatic.

## Actions

Name actions as `domain/event`, in the past tense when they report something
that happened: `nav/changed`, `query/changed`, `cases/load-requested`,
`cases/loaded`, `case/save-failed`. Reducers synchronously return the next
state. Async actions call existing services and re-enter state only through
`dispatch()`.

## Tests

Start at the slice's public seam:

1. Create the slice with a small `AppContext` fixture.
2. Dispatch an action through the reducer and assert the next state.
3. Pass that state to the pure view and assert semantic output from the vtree.
4. Add a narrow route test for the unchanged URL, lazy-load failure boundary,
   and unmount cleanup.
5. Keep protocol, permissions, and service tests at their existing seams; do
   not recreate custom-element lifecycle tests for a converted page.

Run focused tests while converting, then `npm run check`, `npm test`, and
`npm run test:coverage`. The repository-wide 95% line, branch, and function
floors must hold.

## Pull request checklist

- The route behaves identically at the same URL in real and mock modes.
- The old page file, old tests, and old wiring are deleted in the same change.
- The new page exports `createRouteSlice` and a pure view and is added to the
  store-route layering ledger.
- Shared chrome and resolved Case sources come from `AppContext`.
- Focused tests, type checks, the full suite, coverage, formatting, and
  `git diff --check` pass.
- The PR explains the state boundary, effects/data-loading boundary, and proof
  of behaviour parity.

## Delivery rule

From PILOT-2 onward, no new feature code is written in the old
`ShellElement`/`defineView`/application-signal style. Old pages may remain until
their scheduled conversion, but new work uses store slices, actions, effects,
and pure views. Reviewers hold this line.
