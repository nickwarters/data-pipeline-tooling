# Testing

Tests exercise the public seams we want to keep: pure views and reducers,
semantic `h()` output and events, dispatched actions, edge effects, route
registration, and externally visible persistence or protocol contracts.

## Quick Reference

```sh
node --test # run all tests
node --test tests/view.test.js # single file
npm run test:coverage # all production files + enforced thresholds
npm run test:security # focused local security/domain contracts
node --test --watch # re-run on file change
```

## SharePoint heading verification

`tests/sharepoint-breakout.test.js` is the source-level CSS contract for the
SharePoint boundary. Every heading level used by the application (H1-H5), plus
the defensive H6 rule, must declare its exact CORA token directly: H1, H2, H3,
H5, and H6 use `var(--cora-color-on-surface) !important`; H4 retains
`var(--cora-color-text-muted)`. The Question Bank's intentionally muted H3 and
H5 selectors are asserted separately because they must outrank the base rules.

The supported live browser is Edge Chromium. From `platform_frontend/`, run the
source contract and normal gates, then prepare UAT with:

```sh
node --test tests/sharepoint-breakout.test.js
python3 scripts/deploy_to_sharepoint.py \
  --site-url https://sp.example.com/sites/cora --env uat --dry-run
```

The deploy script currently supports dry-run only; its actual SharePoint upload
is manual. After hand-uploading the candidate runtime to the UAT target, open
the UAT page in Edge Chromium without `?mock=1`, hard-reload it, and check the
Outstanding Cases, Case Review, and Roadmap H1 headings plus representative H2,
H3, and Question Bank H3/H5 headings. Confirm the computed colours use CORA
tokens rather than SharePoint theme colours.

## Coverage Policy

`npm run test:coverage` explicitly includes every JavaScript file under `src/`
and `case-types/`; the default Node coverage command otherwise reports only
modules loaded by the tests. The command enforces these repository-wide floors:

- 95% line, branch, and function coverage.

These floors prevent silent coverage regression without making incidental
implementation structure part of the contract. Security, SharePoint protocol,
concurrency, permissions, and outcome/applicability code should retain 100% line
and branch coverage wherever practical.

Coverage must come through the smallest useful public seam. Do not call private
methods, walk numeric child positions, or invoke a DOM stub's private listener
registry solely to cover a line. Exact assertions remain appropriate for an
external request, persisted data shape, security guard, or accepted architecture
boundary.

## Selective Security Assurance

`npm run test:security` uses the repository's existing `node:test` runner for
the small set where a false green is expensive: the HTML injection guard,
capability mapping, section-access policy, failure evaluation, configured
Outcome calculation, and the UAT ACL runner's safety constraints. These tests
assert both allow and deny paths and the important boundary values directly;
they do not require a separate mutation-testing package.

Client-side capability and section-access tests remain UX contracts, not proof
of authorization. Before a production release, run the non-mutating UAT ACL
persona smoke gate against the real `uat_*` SharePoint lists:

1. Copy `scripts/uat-acl-smoke.example.json` outside the repository and list
   every UAT Case list that the release can touch.
2. For each persona, create a JSON file containing the request headers needed
   for that person's authenticated SharePoint session, for example
   `{ "Authorization": "Bearer …" }`. Keep these files outside the repository.
3. Set each configured `headersFileEnv` variable to its headers-file path.
4. Run
   `npm run test:security:uat -- /secure/path/uat-acl-smoke.json`.

For every list, configuration validation requires an allowed reader (which
proves the list exists), a denied reader, and a read-allowed/write-denied
persona. The runner performs GET requests only. It verifies read denial through
the real list-items endpoint and write denial through the list's
`EffectiveBasePermissions`; it never creates, updates, or deletes UAT data. It
also refuses list names without the configured `uat_` prefix.

## Deterministic Async Tests

Tests should await the operation promise returned by the API they called or use
the DOM stub's event-driven `waitFor(() => observableCondition)` helper. Keep
completion detection in the test: production views should not expose test-only
idle state or register their promises with a task tracker. Do not sleep for a
fixed duration, poll a deadline, or flush an arbitrary number of event-loop
turns. Timer behavior uses Node's mock timers; the one real timer-adapter test
may replace `setTimeout` and invoke its callback directly.

`tests/timing-assumptions-contract.test.js` prevents real-time sleeps and
deadline polling from being added to JavaScript tests.

## Layer Ownership

Keep one test at the smallest layer that owns each risk:

- Pure functions own input/output combinations and boundary values.
- Components own semantic rendering and user interaction.
- Routes own URL matching, guards, dependency plumbing, and load failures.
- Flow tests own only critical journeys that cross those boundaries.

Do not repeat a focused assertion in a route-registration or flow suite merely
to prove the same line through another call stack. `register-routes.test.js`
owns the complete route inventory and registration isolation; each
`routes-*.test.js` file owns its route's mount behavior. The in-memory flow
runner owns the load-answer-complete journey, so a second DOM-heavy tracer suite
is unnecessary.

## Capability-Sized Suites

Split large suites around behavior a developer can own and review independently,
not around arbitrary line counts. Keep protocol concerns such as authentication,
retries, queries, mapping, and serialization in separate files even when they
exercise one production module. Put reusable fake clients, response builders,
and DOM harnesses in `tests/helpers/` rather than copying them between suites.

DOM capability modules that rely on one shared global stub use the
`*.tests.js` suffix and are imported by a small `*.test.js` entry point. This
keeps Node's test-runner isolation boundary equivalent to the original suite
while making each capability independently searchable and reviewable. Do not
use an entry point merely to hide an oversized suite; the imported modules
should each represent a named capability.

## Prefer public seams to private structure

Direct use of DOM stub internals, underscore-prefixed methods, and Router
internals makes a test fail on a refactor that changed nothing a user can see.
Prefer `getByRole()`, `queryByRole()`, and `fireEvent()` from
`tests/helpers/semantic-dom.js`. There is no `data-testid` anywhere in the
tree: a control a test cannot name is a control a screen reader cannot name
either, so give it a real accessible name in the markup instead of a test-only
attribute.
Route tests should use `register()`, `init()`, and `navigate()`, or a public
registration spy; do not inspect `_routes` or assign `_container` directly.
The router-internal baseline is now zero and must remain zero. Use
`initRouter()` and `routeRegistrationSpy()` from `tests/helpers/router.js` for
real-navigation and registration-only tests respectively.

## Pure view and reducer tests

Render the exported view from state, interact through semantic DOM helpers, and
assert the action it dispatches. Pass that action through the reducer to prove
the next visible state without coupling the test to store internals.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h } from '../src/lib/html.js';
import { installDom } from './_dom-stub.js';

installDom();

function greetingView(state, { dispatch }) {
  return h(
    'button',
    { onclick: () => dispatch({ type: 'greeting/cleared' }) },
    `Hello, ${state.name}`
  );
}

test('greeting: renders state and dispatches the clear action', () => {
  const actions = [];
  const node = greetingView(
    { name: 'Alex' },
    { dispatch: (action) => actions.push(action) }
  );
  assert.equal(node.textContent, 'Hello, Alex');
  node.click();
  assert.deepEqual(actions, [{ type: 'greeting/cleared' }]);
});
```

A people picker's state is always `PeopleSearchState` from
`src/lib/people-search.js` — `{ query, people, status }`, where `status` is one
of `idle | loading | success | error` — so a picker test covers all four
statuses rather than only the matches. Nothing is selectable in any of them bar
a `success` carrying people; `loading`, `error` and a `success` with none each
render a status line, while `idle` and a `success` with matches render none.

## Route Tests

There is no per-page route test. Registration, parameter forwarding, page
resolution and the failure boundary belong to `registerStoreRoute` and the
`Router`, and are covered once in `tests/store-route.test.js` and
`tests/router.test.js`. Adding a page adds a row to the assertion in
`tests/register-routes.test.js`, which checks the whole table at once — the paths
every route claims, and that each entry's page, imported or thunked, exports
`createRouteSlice`.

Write a route-level test only for behaviour genuinely specific to one route,
such as an eligibility `guard`. Everything else about a page is page behaviour:
test its view and reducer directly.

## Deterministic Async Tests

Await the operation that represents completion. Do not settle a test with a
fixed delay or by guessing how many microtasks an implementation needs.

- DOM tests should use `waitFor(() => observableCondition)` from
  `tests/_dom-stub.js`; the predicate should name the rendered state or external
  call the test asserts, rather than a private task queue.
- For a coalesced store render, use `waitFor()` with the visible DOM state or
  dispatched external result that represents completion.
- `SaveQueue.whenIdle()` observes the real debounce/retry chain without forcing
  an early flush. Inject `setTimer`, `clearTimer`, or `sleep` when a test needs
  to control a debounce or retry boundary precisely.
- Use deferred promises to assert an intermediate state such as
  `reconnecting`, then release the operation and await its completion signal.
- Never drain microtask turns to wait for a cold dynamic `import()` — module
  loading is filesystem I/O, so no number of turns can cover it. Await a
  deferred promise resolved from the stub the code under test calls.
- Keep a real-timer assertion only for the timer adapter itself.

## Red-Green-Refactor

Every behavior change starts with a failing test at the smallest useful public
seam. For new UI, that seam is normally an exported view/reducer pair or a
focused action/effect function.

1. **Red** — write a failing test for the behaviour you are about to add.
2. **Green** — write the minimum production code to make it pass.
3. **Refactor** — clean up, keeping tests green.

## DOM Stubs

Tests run in Node.js, which has no browser DOM. Stub only the DOM methods your
test needs. Keep stubs small so test failures point at the missing behavior. A
stub may use private arrays internally to emulate the DOM; tests using that stub
should interact with its public DOM methods and semantic helpers.

`installDom()` also isolates browser-global state per test. It captures the
file-level DOM after module imports and restores global replacements,
`location`, and document listeners after every test. This means a test may
customise the shared stub without making later tests depend on its cleanup or
execution order.

Suites that need hand-built browser stubs instead of `installDom()` must call
`isolateBrowserGlobals()` from `tests/helpers/browser-globals.js` during
top-level setup. The browser-global isolation contract rejects new direct
global writes that use neither harness. Keep tests within a file sequential
when they replace globals; concurrent tests must use dependency injection
instead of sharing `globalThis`.

## Case Type Tests

Case Type modules under `case-types/` are pure JavaScript. Test them with
straight imports and no DOM stubs.

Standard checks for every Case Type:

- Catalogue has the expected number of questions.
- Every choice question has a non-empty `options[]`.
- All `showWhen` references point to questions in the catalogue.
- No cycles in the `showWhen` graph.
- `computeOutcome` returns the correct result for pass, fail, and refer cases.
- Informational questions without an `optionOutcomes` mapping do not affect
  the outcome and raise no Issues.
