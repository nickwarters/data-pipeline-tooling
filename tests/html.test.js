// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== DOM STUBS =====
//
// A plain element stub plus a `<select>` stub that emulates the one piece of
// real-browser behaviour that matters here: assigning `.value` only "sticks"
// when a matching `<option>` is already a child. Setting it before the options
// exist is a no-op and the select falls back to its first option. This is what
// made grouped capture selects render as the blank "—" after a re-render.

class StubEl {
  /** @param {string} tag */
  constructor(tag) {
    this._tagName = tag;
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this._value = '';
    this.checked = false;
  }
  get value() {
    return this._value;
  }
  set value(/** @type {string} */ v) {
    this._value = v;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
}

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

/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    return tag === 'select' ? new StubSelect() : new StubEl(tag);
  },
  createTextNode(/** @type {string} */ s) {
    const t = new StubEl('#text');
    t.textContent = s;
    return t;
  },
};

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
