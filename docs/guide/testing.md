# Testing

## Quick reference

```sh
node --test                                     # run all tests
node --test tests/cr-notes.test.js              # single file
node --test --experimental-test-coverage        # with coverage (must be 100%)
node --test --watch                             # re-run on file change
```

```js
// tests/cr-my-widget.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 1. Stub the DOM BEFORE importing any src module.
class StubEl { /* … */ }
globalThis.HTMLElement = StubEl;
globalThis.document    = { createElement(_tag) { return new StubEl(); }, … };
globalThis.customElements = { define() {} };

// 2. Dynamic import AFTER stubs are in place.
const { CRMyWidget } = await import('../src/components/cr-my-widget.js');

test('CRMyWidget: renders label text', () => {
  const el = new CRMyWidget();
  el.label = 'Hello';
  el.connectedCallback();
  assert.equal(el._children[0].textContent, 'Hello');
});
```

---

## Red-Green-Refactor

Every line of production code must be covered by a test. The workflow is strict:

1. **Red** — write a failing test for the behaviour you are about to add.
2. **Green** — write the minimum production code to make it pass.
3. **Refactor** — clean up, keeping tests green.

Never write production code without a failing test first, and never merge without 100% coverage.

---

## DOM stubs

Tests run in Node.js, which has no browser DOM. Before importing any `src/` module that touches `HTMLElement`, `document`, or `customElements`, set up lightweight stubs on `globalThis`. The key properties your stub needs to support depend on what the component uses — start with the minimal set and add as tests demand it.

A typical stub:

```js
class StubEl {
  constructor() {
    this._children = [];
    this._listeners = {};
    this.textContent = '';
    this.className = '';
    this.value = '';
  }
  replaceChildren(...cs) {
    this._children = cs;
  }
  appendChild(c) {
    this._children.push(c);
    return c;
  }
  append(...cs) {
    this._children.push(...cs);
  }
  addEventListener(t, h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(k, v) {
    (this._attrs ??= {})[k] = v;
  }
}

globalThis.HTMLElement = StubEl;
globalThis.document = {
  createElement(_tag) {
    return new StubEl();
  },
  addEventListener() {},
};
globalThis.customElements = { define() {} };
```

Then use a dynamic `await import(…)` so the module is evaluated after the stubs are set:

```js
const { CRMyWidget } = await import('../src/components/cr-my-widget.js');
```

---

## What constitutes a good test

Test **external behaviour only** — what the component promises to callers, not how it delivers on that promise.

| Good to test                                                      | Not worth testing                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| DOM structure after `connectedCallback` (children, text, classes) | Internal variable names or private methods                          |
| What is enqueued to `SaveQueue` when an event fires               | The fact that a `setTimeout` was called internally                  |
| That a read-only component does NOT enqueue a save                | Calling `effect` or `computed` directly                             |
| Edge cases the component must handle without throwing             | Implementation details that could change without breaking behaviour |
| That `disconnectedCallback` cleans up subscriptions               | The internal `_disposes` array length                               |

The principle: if you could rewrite the component's internals from scratch and all tests still pass, your tests are testing the right thing.

---

## Testing Case Type modules

Case Type modules (under `case-types/`) are pure JS — no DOM needed. Test them with straightforward imports:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/example-review.js';

test('example-review computeOutcome: any No answer → fail', () => {
  assert.deepStrictEqual(
    config.computeOutcome({ 'q-welcome': { value: 'No' } }),
    { verdict: 'fail' }
  );
});
```

Outcome tests should also protect informational questions. A Question Bank
question in a grouping category such as `General`, with no `failureCriteria`, is
required for completion but outcome-neutral: answering it `No` must not change
the verdict, and it must not create Issues or Remediation. Default and example
outcome functions should count configured failures rather than scanning every raw
answer value for `No`.

Standard checks for every Case Type:

- Catalogue has the expected number of questions.
- Every choice question has a non-empty `options[]`.
- All `showWhen` references point to questions in the catalogue.
- No cycles in the `showWhen` graph (use `detectCycles` from `src/evaluators/applicability-evaluator.js`).
- `computeOutcome` returns the correct verdict for pass, fail, and (if applicable) refer scenarios.
- A no-`failureCriteria` informational question answered `No` does not affect the verdict.

---

## Testing route handlers

Route handlers are plain functions. Test them by calling `mount` with a stub container and a mock `AppContext`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stub document before importing the route
globalThis.document = {
  createElement(_tag) {
    return {
      /* … */
    };
  },
};
globalThis.customElements = { define() {} };

const { register } = await import('../src/routes/my-page.js');

test('my-page mount: places cr-my-page in container', () => {
  /** @type {any[]} */ let placed = [];
  const container = {
    replaceChildren(...els) {
      placed = els;
    },
  };
  const router = {
    register(_pat, handler) {
      handler.mount(container, { id: '42' });
    },
  };
  const context = { client: {}, currentUser: { id: 'u1' } };

  register(/** @type {any} */ (router), /** @type {any} */ (context));

  assert.equal(placed.length, 1);
  // assert whatever property was set on the element:
});
```

---

## Coverage

Run with `--experimental-test-coverage`. Any branch, line, or function that appears as uncovered is a defect in the development process. Fix it before opening a PR.

```sh
node --test --experimental-test-coverage 2>&1 | tail -30
```
