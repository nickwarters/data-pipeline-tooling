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

const { h, svg, unsafeHTML, applyProp, removeProp, getProps, setProps } =
  await import('../src/lib/html.js');

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

// ===== PROP NAMING =====

test('h: throws on a camelCase on[A-Z] prop, which is a component callback', () => {
  // Reaching an element, `onAnswer` would bind a listener for an "answer" event
  // nothing dispatches — silent no-op. Component callbacks are read off a view's
  // own props object and never handed to h().
  assert.throws(
    () => h('div', { onAnswer: () => {} }),
    /does not accept the component callback prop "onAnswer"/
  );
});

test('h: throws on a camelCase on[A-Z] prop whatever its value', () => {
  // The prop name is the error; a component callback that happens to be
  // undefined would otherwise fall through to an `onAnswer=""` attribute.
  assert.throws(
    () => applyProp(/** @type {any} */ ({}), 'onAnswer', undefined),
    /does not accept the component callback prop "onAnswer"/
  );
});

test('h: throws on `class`, so className is the only spelling', () => {
  assert.throws(
    () => h('div', { class: 'c' }),
    /does not accept "class"; the class prop is className/
  );
});

test('h: lowercase on* props still become listeners', () => {
  let calls = 0;
  const el = /** @type {any} */ (h('button', { onclick: () => (calls += 1) }));
  el.dispatchEvent(new /** @type {any} */ (globalThis).CustomEvent('click'));
  assert.equal(calls, 1);
});

test('svg: creates SVG elements and keeps nested SVG elements in the namespace', () => {
  const root = svg('svg', { viewBox: '0 0 10 10' }, svg('g', {}, svg('rect')));
  const group = root.childNodes[0];
  const rect = group.childNodes[0];
  assert.equal(root.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(group.namespaceURI, root.namespaceURI);
  assert.equal(rect.namespaceURI, root.namespaceURI);
  assert.equal(root.getAttribute('viewBox'), '0 0 10 10');
});

test('svg: geometry, presentation, key, and className props are attributes', () => {
  const rect = /** @type {any} */ (
    svg('rect', {
      x: 1,
      width: 10,
      cx: 2,
      fill: 'red',
      key: 'bar',
      className: 'chart-bar',
    })
  );
  assert.equal(rect.getAttribute('x'), '1');
  assert.equal(rect.getAttribute('width'), '10');
  assert.equal(rect.getAttribute('cx'), '2');
  assert.equal(rect.getAttribute('fill'), 'red');
  assert.equal(rect.getAttribute('key'), 'bar');
  assert.equal(rect.getAttribute('class'), 'chart-bar');
  assert.deepEqual(rect._propertyWrites, []);
});

test('svg: listeners install, replace, and remove through the prop helpers', () => {
  let firstCalls = 0;
  let secondCalls = 0;
  const first = () => (firstCalls += 1);
  const second = () => (secondCalls += 1);
  const circle = /** @type {any} */ (svg('circle', { onclick: first }));

  circle.dispatchEvent(new /** @type {any} */ (globalThis).CustomEvent('click'));
  removeProp(circle, 'onclick', first);
  applyProp(circle, 'onclick', second);
  circle.dispatchEvent(new /** @type {any} */ (globalThis).CustomEvent('click'));
  removeProp(circle, 'onclick', second);
  circle.dispatchEvent(new /** @type {any} */ (globalThis).CustomEvent('click'));

  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
});

test('svg: removeProp removes an SVG attribute', () => {
  const rect = /** @type {any} */ (svg('rect', { width: 10, className: 'bar' }));
  removeProp(rect, 'width', 10);
  removeProp(rect, 'className', 'bar');
  assert.equal(rect.getAttribute('width'), null);
  assert.equal(rect.getAttribute('class'), null);
});

test('svg: records authored props for reconciliation', () => {
  const props = { x: 1, className: 'bar' };
  const rect = svg('rect', props);
  props.x = 2;
  assert.deepEqual(getProps(rect), { x: 1, className: 'bar' });
});

// ===== RECONCILER SUPPORT: getProps / setProps / applyProp / removeProp =====
//
// These back render() (src/core/render.js): h() and svg() record the props they
// built an element with, and applyProp/removeProp are the single source of truth
// for how one prop maps onto the DOM (used at build time and when a prop changes).

test('getProps: returns the props h() built a node with', () => {
  const el = h('div', { 'aria-label': 'x', className: 'c' });
  assert.deepEqual(getProps(el), { 'aria-label': 'x', className: 'c' });
});

test('getProps: recorded props are insulated from later caller mutation', () => {
  const props = { className: 'before' };
  const el = h('div', props);
  props.className = 'after';
  assert.deepEqual(getProps(el), { className: 'before' });
});

test('getProps: is undefined for a node h() never built', () => {
  const raw = /** @type {any} */ (globalThis).document.createElement('div');
  assert.equal(getProps(raw), undefined);
});

test('setProps: overwrites the recorded props', () => {
  const el = h('div', { className: 'a' });
  setProps(el, { className: 'b' });
  assert.deepEqual(getProps(el), { className: 'b' });
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
  const el = /** @type {any} */ (h('button', { onclick: fn }));
  removeProp(el, 'onclick', fn);
  el.dispatchEvent(new /** @type {any} */ (globalThis).CustomEvent('click'));
  assert.equal(calls, 0, 'handler no longer fires after removal');
});

test('removeProp: clears className', () => {
  const el = /** @type {any} */ (h('div', { className: 'c' }));
  removeProp(el, 'className', 'c');
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

test('removeProp: resets a numeric property to zero', () => {
  const el = /** @type {any} */ (h('div', { tabIndex: -1 }));
  removeProp(el, 'tabIndex', -1);
  assert.equal(el.tabIndex, 0);
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
