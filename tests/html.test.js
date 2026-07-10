// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';

installDom();

// ===== DOM STUBS =====
//
// A plain element stub plus a `<select>` stub that emulates the one piece of
// real-browser behaviour that matters here: assigning `.value` only "sticks"
// when a matching `<option>` is already a child. Setting it before the options
// exist is a no-op and the select falls back to its first option. This is what
// made grouped capture selects render as the blank "—" after a re-render.

class StubSelect extends StubEl {
  constructor() {
    super('select');
    /** @type {string | null} */
    this._explicit = null;
  }
  /** @returns {StubEl[]} */
  get _options() {
    return this._children.filter((c) => c._tagName === 'option');
  }
  set value(v) {
    // Mirrors the browser: only honour a value that has a matching option.
    if (this._options.some((o) => o.value === v)) this._explicit = v;
  }
  get value() {
    if (
      this._explicit != null &&
      this._options.some((o) => o.value === this._explicit)
    ) {
      return this._explicit;
    }
    return this._options[0]?.value ?? '';
  }
}

const _doc = /** @type {any} */ (globalThis).document;
const _baseCreate = _doc.createElement.bind(_doc);
_doc.createElement = (/** @type {string} */ tag) =>
  tag === 'select' ? new StubSelect() : _baseCreate(tag);

const { h, unsafeHTML } = await import('../src/lib/html.js');

// ===== TESTS =====

test('h: a <select> reflects a value that matches an option appended after it', () => {
  const select = h(
    'select',
    { value: 'Med' },
    h('option', { value: '' }, '—'),
    h('option', { value: 'Low' }, 'Low'),
    h('option', { value: 'Med' }, 'Med'),
    h('option', { value: 'High' }, 'High')
  );
  assert.equal(/** @type {any} */ (select).value, 'Med');
});

test('h: a <select> with no matching option falls back to the blank option', () => {
  const select = h(
    'select',
    { value: 'Nope' },
    h('option', { value: '' }, '—'),
    h('option', { value: 'Low' }, 'Low')
  );
  assert.equal(/** @type {any} */ (select).value, '');
});

test('h: value still applies to a plain input', () => {
  const input = h('input', { type: 'text', value: 'hello' });
  assert.equal(/** @type {any} */ (input).value, 'hello');
});

test('h: rejects incidental innerHTML props', () => {
  assert.throws(
    () => h('div', { innerHTML: '<strong>unsafe</strong>' }),
    /does not accept innerHTML/
  );
});

test('h: unsafeHTML is an explicit raw HTML escape hatch', () => {
  const div = h('div', {}, unsafeHTML('<strong>reviewed</strong>'));
  assert.equal(/** @type {any} */ (div).innerHTML, '<strong>reviewed</strong>');
});

test('h: a value-less <select> defaults to its first option', () => {
  const select = h(
    'select',
    {},
    h('option', { value: 'a' }, 'a'),
    h('option', { value: 'b' }, 'b')
  );
  assert.equal(/** @type {any} */ (select).value, 'a');
});

// ===== DEV-MODE WARNING FOR UNREGISTERED cora-* ELEMENTS =====

test('h: warns once when a cora-* tag has no registered custom element', async () => {
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    h('cora-nonexistent-element', {});
    // The check is deferred to a microtask so a defining module that is
    // still mid-import in the same tick isn't flagged as a false positive.
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /<cora-nonexistent-element>/);
  assert.match(calls[0][0], /is not defined/);
});

test('h: warns exactly once per unknown tag even when rendered repeatedly', async () => {
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    h('cora-repeatedly-missing', {});
    h('cora-repeatedly-missing', {});
    h('cora-repeatedly-missing', {});
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 1);
});

test('h: does not warn for a registered cora-* custom element', async () => {
  /** @type {any} */ (globalThis).customElements.define(
    'cora-registered-fixture',
    class extends /** @type {any} */ (globalThis).HTMLElement {}
  );
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    h('cora-registered-fixture', {});
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 0);
});

test('h: does not warn for non cora-* tags, even if unregistered', async () => {
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    h('div', {});
    h('some-other-widget', {});
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 0);
});

test('h: a cora-* element registered before the microtask check runs is not warned about', async () => {
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    h('cora-registers-late', {});
    // Simulate the defining module finishing registration in the same tick,
    // before the deferred check fires.
    /** @type {any} */ (globalThis).customElements.define(
      'cora-registers-late',
      class extends /** @type {any} */ (globalThis).HTMLElement {}
    );
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 0);
});
