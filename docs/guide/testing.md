# Testing

Tests should exercise the public seams we want to keep: plain function
components, `h()` output, signal-driven `reactive()` updates, pure functions,
and thin route shells.

Lifecycle-heavy tests are legacy coverage. Add new
`connectedCallback()`/`disconnectedCallback()` tests only when you are explicitly
testing a browser/custom-element boundary.

## Quick Reference

```sh
node --test # run all tests
node --test tests/view.test.js # single file
npm run test:coverage # all production files + enforced thresholds
npm run test:security # focused local security/domain contracts
npm run test:security:mutation # mutation gate for critical kernels
node --test --watch # re-run on file change
```

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

`npm run test:security:mutation` runs Stryker only against the small set where a
false green is expensive: the HTML injection guard, capability mapping,
section-access policy, failure evaluation, and configured Outcome calculation.
It deliberately does not mutate every component or protocol adapter. The gate
enforces a 95% mutation score; generated reports live under ignored
`reports/mutation/`.

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

## White-box Debt Guardrail

`tests/white-box-debt-contract.test.js` records the remaining direct uses of DOM
stub internals, underscore-prefixed methods, and Router internals in test files.
It is a migration baseline, not an approved-pattern list:

- New test files must not add these patterns.
- Existing test files must not increase their recorded counts.
- When a migration reduces a count, lower the baseline in the same change so
  the debt cannot return later.
- Increase a baseline only when the private structure is itself an intentional,
  named contract. Explain that exception next to the baseline entry.

Prefer `getByRole()`, `queryByRole()`, and `fireEvent()` from
`tests/helpers/semantic-dom.js`. A stable field key or narrowly scoped
`data-testid` is acceptable when the UI has no user-facing semantic to query.
Route tests should use `register()`, `init()`, and `navigate()`, or a public
registration spy; do not inspect `_routes` or assign `_container` directly.
The router-internal baseline is now zero and must remain zero. Use
`initRouter()` and `routeRegistrationSpy()` from `tests/helpers/router.js` for
real-navigation and registration-only tests respectively.

## Function Component Tests

Prefer importing a plain function and asserting the DOM nodes it returns.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h } from '../src/lib/html.js';
import { installDom } from './_dom-stub.js';

installDom();

function Greeting({ name }) {
  return h('p', {}, `Hello, ${name}`);
}

test('Greeting: renders the supplied name', () => {
  const node = Greeting({ name: 'Alex' });
  assert.equal(node.tagName, 'P');
  assert.equal(node.textContent, 'Hello, Alex');
});
```

## Reactive Tests

Use `reactive()` when the component reads signals while rendering.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h } from '../src/lib/html.js';
import { signal } from '../src/lib/signal.js';
import { reactive } from '../src/lib/view.js';
import { fireEvent, getByRole } from './helpers/semantic-dom.js';

function Counter() {
  const count = signal(0);
  return reactive(() =>
    h(
      'button',
      { type: 'button', onclick: () => count.set(count.get() + 1) },
      count.get()
    )
  );
}

test('Counter: updates when clicked', () => {
  const host = Counter();
  const button = getByRole(host, 'button');

  assert.equal(button.textContent, '0');
  fireEvent(button, 'click');
  assert.equal(getByRole(host, 'button').textContent, '1');
});
```

## Route Tests

Route handlers are plain functions. Test them by registering the route, calling
`mount`, and asserting what the route places in the container.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/root.js';

test('root route: renders home sections', () => {
  const router = new Router();
  const rendered = [];
  const appEl = {
    replaceChildren(...children) {
      rendered.splice(0, rendered.length, ...children);
    },
  };

  register(router, {
    appEl,
    capabilities: { isVisitor: true, ownedCaseTypes: [] },
  });
  router.navigate('#/');

  assert.equal(rendered.length, 1);
});
```

## Deterministic Async Tests

Await the operation that represents completion. Do not settle a test with a
fixed delay or by guessing how many microtasks an implementation needs.

- Async views should expose `whenIdle()` through `trackAsyncTasks()`; DOM tests
  can await the subtree with `whenIdle(host)` from `tests/_dom-stub.js`.
- `SaveQueue.whenIdle()` observes the real debounce/retry chain without forcing
  an early flush. Inject `setTimer`, `clearTimer`, or `sleep` when a test needs
  to control a debounce or retry boundary precisely.
- Use deferred promises to assert an intermediate state such as
  `reconnecting`, then release the operation and await its completion signal.
- Keep a real-timer assertion only for the timer adapter itself.

## Legacy Shell Tests

When a test must cover a custom-element shell, keep it narrow:

- Stub `HTMLElement`, `document`, and `customElements` before importing the
  shell module.
- Prefer asserting the shell forwards props/events correctly.
- Do not test private lifecycle bookkeeping.
- Do not navigate `_children` by numeric position or call `_listeners` directly
  when a role, accessible name, stable field key, or public event expresses the
  behaviour.
- Do not use shell tests as the default pattern for new feature UI.

## Red-Green-Refactor

Every behavior change should start with a failing test at the smallest useful
public seam. For most new UI, that seam is a plain function component or a pure
action/binding function, not a class instance.

1. **Red** — write a failing test for the behaviour you are about to add.
2. **Green** — write the minimum production code to make it pass.
3. **Refactor** — clean up, keeping tests green.

## DOM Stubs

Tests run in Node.js, which has no browser DOM. Stub only the DOM methods your
test needs. Keep stubs small so test failures point at the missing behavior. A
stub may use private arrays internally to emulate the DOM; tests using that stub
should interact with its public DOM methods and semantic helpers.

`installDom()` also isolates browser-global state per test. It captures the
file-level DOM after component imports and restores global replacements,
`location`, and document listeners after every test. Custom-element definitions
remain append-only, matching the browser and allowing lazy module imports to be
cached safely. This means a test may customise the shared stub without making
later tests depend on its cleanup or execution order.

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
- Informational questions without `failureCriteria` do not affect the outcome.
