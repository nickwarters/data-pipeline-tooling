// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal stubs so component modules can be imported in Node.
class StubEl {
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  getAttribute() { return null; }
  replaceChildren() {}
  appendChild(/** @type {any} */ c) { return c; }
  append() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
/** @type {{ tagName: string }[]} */
const bodyChildren = [];
(/** @type {any} */ (globalThis)).document = {
  createElement(/** @type {string} */ tag) {
    const el = new StubEl();
    (/** @type {any} */ (el)).tagName = tag.toUpperCase();
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
  body: {
    appendChild(/** @type {any} */ el) { bodyChildren.push(el); return el; },
  },
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };
(/** @type {any} */ (globalThis)).window = { addEventListener() {} };
(/** @type {any} */ (globalThis)).location = { hash: '' };

import { registerComponents } from '../src/setup/register-components.js';

test('registerComponents: returns a Promise', () => {
  const result = registerComponents();
  assert.ok(result instanceof Promise, 'registerComponents() should return a Promise');
  return result;
});

test('registerComponents: resolves without error', async () => {
  await assert.doesNotReject(() => registerComponents());
});

test('registerComponents: appends cr-command-palette to document.body', async () => {
  bodyChildren.length = 0;
  await registerComponents();
  assert.ok(
    bodyChildren.some(el => el.tagName === 'CR-COMMAND-PALETTE'),
    'cr-command-palette should be appended to body'
  );
});
