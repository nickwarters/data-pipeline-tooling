# Add a store-driven page

This is the shortest path from a new hash to a working CORA page. The whole
authoring model is: **write a function from state to `h()`; dispatch actions**.
The route adapter owns the store, rendering, listener cleanup, and teardown.

## 1. Describe the state and actions

Keep page state under one named route key. Reuse the boot-owned `chrome` state;
do not copy current-user, navigation, permission, or toast values into the page.

```js
/** @typedef {{ chrome: import('../core/chrome-state.js').ChromeState,
 * routes: { greeting: { name: string } } }} GreetingState */
/** @typedef {{ type: 'greeting/name-changed', name: string }} GreetingAction */
```

Action names use `domain/event` wording. They describe what happened, not which
DOM control produced it.

## 2. Write the pure view

A view is synchronous and deterministic: state in, an `h()` tree out. Event
callbacks dispatch actions. A view never fetches, saves, awaits, subscribes,
mutates state, or owns cleanup.

```js
// src/pages/greeting.js
// @ts-check
import { h } from '../lib/html.js';

/** @param {GreetingState} state
 * @param {{ dispatch: (action: GreetingAction) => void }} tools */
export function greetingView(state, { dispatch }) {
  const { name } = state.routes.greeting;
  return h(
    'main',
    { className: 'cora-greeting' },
    h('h1', {}, name ? `Hello, ${name}` : 'Hello'),
    h(
      'label',
      {},
      'Name',
      h('input', {
        value: name,
        oninput: (event) =>
          dispatch({
            type: 'greeting/name-changed',
            name: /** @type {HTMLInputElement} */ (event.currentTarget).value,
          }),
      })
    )
  );
}
```

Use `h()` for text and attributes; never put user data into `innerHTML`. Keep
the `cora-` class prefix so SharePoint styles cannot leak across the boundary.

**Prop naming.** DOM events handed to `h()` are lowercase (`onclick`, `oninput`,
`onchange`, `onkeydown`) and the class prop is `className` — never `class`.
camelCase `on[A-Z]` names are reserved for component callback props (`onAnswer`,
`onSort`, `onCommit`): a view function reads those off its own props object, so
they never reach an element. Handing either spelling to `h()` throws
immediately, naming the prop and the correct form — so a mistake surfaces at the
call site that made it, not as a listener that never fires.

## 3. Add the reducer and route slice

Reducers return the next state without mutating the previous state. The page
exports `createRouteSlice(params, context)`, which is the public contract used
by the route adapter.

```js
/** @param {GreetingState} state @param {GreetingAction} action */
export function greetingReducer(state, action) {
  if (action.type !== 'greeting/name-changed') return state;
  return {
    ...state,
    routes: {
      ...state.routes,
      greeting: { ...state.routes.greeting, name: action.name },
    },
  };
}

export function createRouteSlice(_params, context) {
  return {
    initialState: {
      chrome: context.chrome,
      routes: { greeting: { name: '' } },
    },
    reducer: greetingReducer,
    view: greetingView,
  };
}
```

For expensive repeated children, use the `memo` tool supplied to the view. Do
not add a second state system.

## 4. Put I/O in an effect

If the page loads data, persists through `SaveQueue`, or listens outside its
rendered DOM, return a `start(tools)` function from the slice or call a focused
action module from it. Effects may use the client and may await. Their only way
back into page state is `dispatch(...)`.

```js
start({ dispatch, listen, isActive }) {
  void loadGreeting(context.client).then((name) => {
    if (isActive()) dispatch({ type: 'greeting/name-changed', name });
  });
  listen(window, 'online', () => dispatch({ type: 'network/online' }));
}
```

Guard every dispatch that follows an `await` or a `.then()` with `isActive()` —
the user may have navigated away, and the store is disposed. Do not hand-roll a
`let active = true` latch; the adapter owns the mount lifetime.

Use `listen(target, type, listener)` for external listeners; the route adapter
removes them on navigation. Return a cleanup function from `start` for any
other edge resource. Persistence belongs in an action module and goes through
`SharePointClient` and `SaveQueue`, never directly through `fetch()`.

## 5. Register the lazy route

Add one entry to the route table. The page is reached only through an
`import()` thunk, so one broken page cannot break startup or a sibling route.

```js
// src/setup/register-routes.js, inside routeTable(context)
greeting: {
  paths: ['#/greeting'],
  load: () => import('../pages/greeting.js'),
},
```

`registerRoutes()` builds the `createStoreRoute()` adapter for each entry and
registers it on every path in `paths`; add a `guard: () => boolean` if the route
needs an eligibility check before mounting. The `import()` thunk is what
ADR-0002's page independence rests on — nothing outside `src/pages/` may import
a page any other way.

Add navigation only when the page is meant to be discoverable there.

## 6. Prove the public behaviour

Test one behaviour at a time through exported seams:

1. Render the view with state and assert semantic output.
2. Fire a user event and assert the dispatched action.
3. Pass that action through the reducer and assert the next visible state.
4. Test effects through their client/queue boundary and resulting dispatch.
5. Test route registration and lazy-load failure containment separately.

Then run:

```sh
node --test tests/<focused-test>.test.js
npm run check
npm test
```

Before opening a PR, check the result against ADR-0034 (store-driven views),
ADR-0035 (descriptors contain data, branching stays in code), the security and
storage ADRs touched by the page, and the hard rules in `CLAUDE.md`.
