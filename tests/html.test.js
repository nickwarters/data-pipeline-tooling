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

const { h, unsafeHTML, applyProp, removeProp, getProps, setProps } =
  await import('../src/lib/html.js');

/**
 * Run the exact microtasks scheduled by h() without guessing how many event-loop
 * turns are needed. The queue is restored before the assertion runs.
 * @param {() => void} action
 */
function runDeferredElementChecks(action) {
  const originalQueueMicrotask = globalThis.queueMicrotask;
  /** @type {Function[]} */
  const queued = [];
  globalThis.queueMicrotask = (callback) => {
    queued.push(callback);
  };
  try {
    action();
    while (queued.length > 0) queued.shift()?.();
  } finally {
    globalThis.queueMicrotask = originalQueueMicrotask;
  }
}

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

// ===== BUTTONS DEFAULT TO type="button" =====
//
// SharePoint hosts the app inside a page-wide <form>. A <button> with no
// explicit type defaults to type="submit" in the DOM, so any click was
// triggering a full-page form submission/postback. h() defaults <button>s to
// type="button" so they behave as plain buttons unless a type is asked for.

test('h: a <button> with no type defaults to type="button"', () => {
  const btn = h('button', {}, 'Click me');
  assert.equal(/** @type {any} */ (btn).getAttribute('type'), 'button');
});

test('h: an explicit button type is preserved', () => {
  const btn = h('button', { type: 'submit' }, 'Submit');
  assert.equal(/** @type {any} */ (btn).getAttribute('type'), 'submit');
});

test('h: non-button tags are not given a type', () => {
  const div = h('div', {}, 'hi');
  assert.equal(/** @type {any} */ (div).getAttribute('type'), null);
});

// ===== DEV-MODE WARNING FOR UNREGISTERED cora-* ELEMENTS =====

test('h: warns once when a cora-* tag has no registered custom element', () => {
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    runDeferredElementChecks(() => h('cora-nonexistent-element', {}));
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /<cora-nonexistent-element>/);
  assert.match(calls[0][0], /is not defined/);
});

test('h: warns exactly once per unknown tag even when rendered repeatedly', () => {
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    runDeferredElementChecks(() => {
      h('cora-repeatedly-missing', {});
      h('cora-repeatedly-missing', {});
      h('cora-repeatedly-missing', {});
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 1);
});

test('h: does not warn for a registered cora-* custom element', () => {
  /** @type {any} */ (globalThis).customElements.define(
    'cora-registered-fixture',
    class extends /** @type {any} */ (globalThis).HTMLElement {}
  );
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    runDeferredElementChecks(() => h('cora-registered-fixture', {}));
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 0);
});

test('h: does not warn for non cora-* tags, even if unregistered', () => {
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    runDeferredElementChecks(() => {
      h('div', {});
      h('some-other-widget', {});
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 0);
});

test('h: a cora-* element registered before the microtask check runs is not warned about', () => {
  /** @type {any[][]} */
  const calls = [];
  const originalWarn = console.warn;
  console.warn = (/** @type {any[]} */ ...args) => calls.push(args);
  try {
    runDeferredElementChecks(() => {
      h('cora-registers-late', {});
      // Simulate the defining module finishing registration in the same tick,
      // before the deferred check fires.
      /** @type {any} */ (globalThis).customElements.define(
        'cora-registers-late',
        class extends /** @type {any} */ (globalThis).HTMLElement {}
      );
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls.length, 0);
});

test('h: a camelCase on* prop matching a declared element property is set as a callback, not a listener', () => {
  class WithCallback extends StubEl {
    constructor() {
      super('cora-cb-host');
      /** @type {(fn: () => void) => void} */
      this.onCommit = (fn) => fn();
    }
  }
  /** @type {any} */ (globalThis).customElements.define(
    'cora-cb-host',
    WithCallback
  );
  const sink = () => {};
  const el = /** @type {any} */ (h('cora-cb-host', { onCommit: sink }));
  assert.equal(el.onCommit, sink);
  assert.equal(el._listeners.commit, undefined);
});

test('h: a camelCase on* prop with no matching property still becomes a listener', () => {
  const fn = () => {};
  const el = /** @type {any} */ (h('div', { onClick: fn }));
  assert.deepEqual(el._listeners.click, [fn]);
});

// ===== RECONCILER SUPPORT: getProps / setProps / applyProp / removeProp =====
//
// These back morph() (src/core/morph.js): h() records the props it built an
// element with, and applyProp/removeProp are the single source of truth for how
// one prop maps onto the DOM (used at build time and when a prop changes).

test('getProps: returns the props h() built a node with', () => {
  const el = h('div', { 'aria-label': 'x', class: 'c' });
  assert.deepEqual(getProps(el), { 'aria-label': 'x', class: 'c' });
});

test('getProps: is undefined for a node h() never built', () => {
  const raw = /** @type {any} */ (globalThis).document.createElement('div');
  assert.equal(getProps(raw), undefined);
});

test('setProps: overwrites the recorded props', () => {
  const el = h('div', { class: 'a' });
  setProps(el, { class: 'b' });
  assert.deepEqual(getProps(el), { class: 'b' });
});

test('applyProp: sets a value property directly on a form control', () => {
  const input = h('input', {});
  applyProp(input, 'value', 'typed');
  assert.equal(/** @type {any} */ (input).value, 'typed');
});

test('applyProp: throws on innerHTML', () => {
  const el = h('div', {});
  assert.throws(() => applyProp(el, 'innerHTML', '<b>x</b>'), /innerHTML/);
});

test('removeProp: innerHTML is a no-op', () => {
  const el = h('div', {});
  assert.doesNotThrow(() => removeProp(el, 'innerHTML', '<b>x</b>'));
});

test('removeProp: unbinds an addEventListener-style handler', () => {
  let calls = 0;
  const fn = () => (calls += 1);
  const el = /** @type {any} */ (h('button', { onClick: fn }));
  removeProp(el, 'onClick', fn);
  el.dispatchEvent(new /** @type {any} */ (globalThis).CustomEvent('click'));
  assert.equal(calls, 0, 'handler no longer fires after removal');
});

test('removeProp: clears an on[A-Z] callback property', () => {
  class Host extends StubEl {
    constructor() {
      super('cora-remove-prop-host');
      /** @type {any} */
      this.onCommit = () => {};
    }
  }
  /** @type {any} */ (globalThis).customElements.define(
    'cora-remove-prop-host',
    Host
  );
  const el = /** @type {any} */ (
    h('cora-remove-prop-host', { onCommit: () => {} })
  );
  removeProp(el, 'onCommit', el.onCommit);
  assert.equal(el.onCommit, null);
});

test('removeProp: clears className', () => {
  const el = /** @type {any} */ (h('div', { class: 'c' }));
  removeProp(el, 'class', 'c');
  assert.equal(el.className, '');
});

test('removeProp: clears a value property', () => {
  const input = /** @type {any} */ (h('input', { value: 'x' }));
  removeProp(input, 'value', 'x');
  assert.equal(input.value, '');
});

test('removeProp: resets a boolean property to false', () => {
  const input = /** @type {any} */ (h('input', { disabled: true }));
  removeProp(input, 'disabled', true);
  assert.equal(input.disabled, false);
});

test('removeProp: resets a non-boolean property to empty string', () => {
  const el = /** @type {any} */ (h('a', { title: 'hint' }));
  removeProp(el, 'title', 'hint');
  assert.equal(el.title, '');
});

test('removeProp: removes a plain attribute', () => {
  const el = /** @type {any} */ (h('div', { 'aria-label': 'x' }));
  removeProp(el, 'aria-label', 'x');
  assert.equal(el.getAttribute('aria-label'), null);
});
