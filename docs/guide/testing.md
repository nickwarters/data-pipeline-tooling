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

## White-box Debt Guardrail

`tests/white-box-debt-contract.test.js` records the remaining direct uses of DOM
stub internals and underscore-prefixed methods in test files. It is a migration
baseline, not an approved-pattern list:

- New test files must not add these patterns.
- Existing test files must not increase their recorded counts.
- When a migration reduces a count, lower the baseline in the same change so
  the debt cannot return later.
- Increase a baseline only when the private structure is itself an intentional,
  named contract. Explain that exception next to the baseline entry.

Prefer `getByRole()`, `queryByRole()`, and `fireEvent()` from
`tests/helpers/semantic-dom.js`. A stable field key or narrowly scoped
`data-testid` is acceptable when the UI has no user-facing semantic to query.

## Function Component Tests

Prefer importing a plain function and asserting the DOM nodes it returns.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h } from '../src/lib/html.js';

class StubEl {
  constructor(tag = '') {
    this.tagName = tag.toUpperCase();
    this._children = [];
    this.textContent = '';
  }
  appendChild(child) {
    this._children.push(child);
    return child;
  }
  replaceChildren(...children) {
    this._children = children;
  }
  setAttribute() {}
}

globalThis.document = {
  createElement(tag) {
    return new StubEl(tag);
  },
  createTextNode(text) {
    const node = new StubEl('#text');
    node.textContent = text;
    return node;
  },
};

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
