// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h } from '../src/lib/html.js';
import { signal } from '../src/lib/signal.js';
import {
  afterMount,
  captureFocus,
  createLifecycle,
  defineView,
  on,
  reactive,
  restoreFocus,
} from '../src/lib/view.js';

class StubEl extends EventTarget {
  /** @param {string} tag */
  constructor(tag = '') {
    super();
    this.tagName = tag.toUpperCase();
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, string>} */
    this._attrs = {};
    /** @type {StubEl | null} */
    this.parentNode = null;
    this.textContent = '';
    this.className = '';
    this.value = '';
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  appendChild(/** @type {StubEl} */ child) {
    child.parentNode = this;
    this._children.push(child);
    return child;
  }

  append(/** @type {StubEl[]} */ ...children) {
    for (const child of children) this.appendChild(child);
  }

  replaceChildren(/** @type {StubEl[]} */ ...children) {
    for (const child of this._children) child.parentNode = null;
    this._children = [];
    for (const child of children) this.appendChild(child);
  }

  setAttribute(/** @type {string} */ name, /** @type {unknown} */ value) {
    this._attrs[name] = String(value);
  }

  getAttribute(/** @type {string} */ name) {
    return this._attrs[name] ?? null;
  }

  focus() {
    /** @type {any} */ (globalThis).document._active = this;
  }

  setSelectionRange(/** @type {number} */ start, /** @type {number} */ end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  /** @param {string} selector */
  querySelector(selector) {
    return findFirst(this, (node) => matches(node, selector));
  }
}

/**
 * @param {StubEl} root
 * @param {(node: StubEl) => boolean} predicate
 * @returns {StubEl | null}
 */
function findFirst(root, predicate) {
  for (const child of root._children) {
    if (predicate(child)) return child;
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

/** @param {StubEl} node @param {string} selector */
function matches(node, selector) {
  if (selector.startsWith('[data-focus-key=')) {
    const expected = selector.slice('[data-focus-key="'.length, -2);
    return node.getAttribute('data-focus-key') === expected;
  }
  return node.tagName === selector.toUpperCase();
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  _active: null,
  get activeElement() {
    return this._active;
  },
  createElement(/** @type {string} */ tag) {
    const ctor = /** @type {any} */ (globalThis).customElements?._registry[tag];
    return ctor ? new ctor() : new StubEl(tag);
  },
  createTextNode(/** @type {string} */ text) {
    const node = new StubEl('#text');
    node.textContent = text;
    return node;
  },
};
/** @type {any} */ (globalThis).customElements = {
  _registry: {},
  define(
    /** @type {string} */ tag,
    /** @type {CustomElementConstructor} */ ctor
  ) {
    this._registry[tag] = ctor;
  },
};
/** @type {any} */ (globalThis).CSS = {
  escape: (/** @type {string} */ s) => String(s),
};

test('view API: exports the future framework primitives', () => {
  assert.equal(typeof defineView, 'function');
  assert.equal(typeof reactive, 'function');
  assert.equal(typeof createLifecycle, 'function');
  assert.equal(typeof on, 'function');
  assert.equal(typeof afterMount, 'function');
  assert.equal(typeof captureFocus, 'function');
  assert.equal(typeof restoreFocus, 'function');
});

test('reactive: renders a plain function component into a host node', () => {
  const host = /** @type {StubEl} */ (
    /** @type {unknown} */ (reactive(() => h('p', {}, 'Hello')))
  );

  assert.equal(host.tagName, 'DIV');
  assert.equal(host._children.length, 1);
  assert.equal(host._children[0].tagName, 'P');
  assert.equal(host._children[0].textContent, 'Hello');
});

test('reactive: re-renders when signals read by render change', () => {
  const label = signal('one');
  const host = /** @type {StubEl} */ (
    /** @type {unknown} */ (reactive(() => h('p', {}, label.get())))
  );

  assert.equal(host._children[0].textContent, 'one');
  label.set('two');
  assert.equal(host._children[0].textContent, 'two');
});

test('reactive: supports node arrays and undefined render output', () => {
  const visible = signal(true);
  const host = /** @type {StubEl} */ (
    /** @type {unknown} */ (
      reactive(() =>
        visible.get() ? [h('span', {}, 'A'), h('span', {}, 'B')] : undefined
      )
    )
  );

  assert.deepEqual(
    host._children.map((child) => child.textContent),
    ['A', 'B']
  );
  visible.set(false);
  assert.equal(host._children.length, 0);
});

test('reactive: disposes render effects when the host disconnects', () => {
  const label = signal('one');
  let renders = 0;
  const host = /** @type {StubEl & { disconnectedCallback: () => void }} */ (
    /** @type {unknown} */ (
      reactive(() => {
        renders++;
        return h('p', {}, label.get());
      })
    )
  );

  assert.equal(renders, 1);
  label.set('two');
  assert.equal(renders, 2);

  host.disconnectedCallback();
  label.set('three');

  assert.equal(renders, 2);
  assert.equal(host._children.length, 0);
});

test('reactive: supports local signal state inside function components', () => {
  function Counter() {
    const count = signal(0);
    return reactive(() =>
      h(
        'button',
        { onClick: () => count.set(count.get() + 1) },
        String(count.get())
      )
    );
  }

  const host = /** @type {StubEl} */ (/** @type {unknown} */ (Counter()));
  const button = host._children[0];
  assert.equal(button.textContent, '0');

  button.dispatchEvent(new Event('click'));
  assert.equal(host._children[0].textContent, '1');
});

test('reactive: lifecycle helpers clean up listeners on re-render and disconnect', () => {
  const label = signal('one');
  let calls = 0;
  let cleanups = 0;
  const target = new EventTarget();
  const host = /** @type {StubEl & { disconnectedCallback: () => void }} */ (
    /** @type {unknown} */ (
      reactive(() => {
        label.get();
        on(target, 'ping', () => calls++);
        afterMount(() => () => cleanups++);
        return h('p', {}, label.get());
      })
    )
  );

  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);

  label.set('two');
  assert.equal(cleanups, 1);
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 2);

  host.disconnectedCallback();
  assert.equal(cleanups, 2);
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 2);
});

test('defineView: remains available for custom-element shell boundaries', () => {
  defineView('cr-test-shell', {
    props: { label: 'Default' },
    render({ props }) {
      return h('p', {}, props.label);
    },
  });

  const el =
    /** @type {StubEl & { label: string, connectedCallback: () => void }} */ (
      /** @type {unknown} */ (document.createElement('cr-test-shell'))
    );
  el.label = 'Route shell';
  el.connectedCallback();

  assert.equal(el._children[0].textContent, 'Route shell');
});

test('on: removes registered listeners when the owning lifecycle disconnects', () => {
  const lifecycle = createLifecycle();
  const target = new EventTarget();
  let calls = 0;
  const listener = () => calls++;

  lifecycle.run(() => on(target, 'ping', listener));

  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);

  lifecycle.disconnect();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);
});

test('on: resolves lazy listener targets inside the owning lifecycle', () => {
  const lifecycle = createLifecycle();
  const target = new EventTarget();
  let calls = 0;

  lifecycle.run(() =>
    on(
      () => target,
      'ping',
      () => calls++
    )
  );
  target.dispatchEvent(new Event('ping'));

  assert.equal(calls, 1);
});

test('on: throws when called without an owning lifecycle', () => {
  assert.throws(
    () => on(new EventTarget(), 'ping', () => {}),
    /on\(\) must be called while a view is mounting/
  );
});

test('afterMount: runs registered hooks on mount and disposes returned cleanup', () => {
  const lifecycle = createLifecycle();
  let mounts = 0;
  let cleanups = 0;

  lifecycle.run(() =>
    afterMount(() => {
      mounts++;
      return () => cleanups++;
    })
  );

  assert.equal(mounts, 0);
  lifecycle.mount();
  lifecycle.mount();
  assert.equal(mounts, 1);
  assert.equal(cleanups, 0);

  lifecycle.disconnect();
  assert.equal(cleanups, 1);
});

test('afterMount: runs hooks inside the owning lifecycle', () => {
  const lifecycle = createLifecycle();
  const target = new EventTarget();
  let calls = 0;

  lifecycle.run(() =>
    afterMount(() => {
      on(target, 'ping', () => calls++);
    })
  );

  lifecycle.mount();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);

  lifecycle.disconnect();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);
});

test('afterMount: throws when called without an owning lifecycle', () => {
  assert.throws(
    () => afterMount(() => {}),
    /afterMount\(\) must be called while a view is mounting/
  );
});

test('captureFocus/restoreFocus: preserves data-focus-key and selection', () => {
  const root = new StubEl('div');
  const before = new StubEl('input');
  before.setAttribute('data-focus-key', 'answer:1');
  before.selectionStart = 2;
  before.selectionEnd = 5;
  root.replaceChildren(before);
  before.focus();

  const snapshot = captureFocus(/** @type {any} */ (root));
  const after = new StubEl('input');
  after.setAttribute('data-focus-key', 'answer:1');
  root.replaceChildren(after);

  restoreFocus(/** @type {any} */ (root), snapshot);

  assert.equal(document.activeElement, after);
  assert.equal(after.selectionStart, 2);
  assert.equal(after.selectionEnd, 5);
});

test('reactive: preserves focus and selection across signal-driven re-render', () => {
  const label = signal('one');
  const host = /** @type {StubEl} */ (
    /** @type {unknown} */ (
      reactive(() =>
        h('input', { 'data-focus-key': 'answer', value: label.get() })
      )
    )
  );
  const input = host._children[0];
  input.selectionStart = 1;
  input.selectionEnd = 2;
  input.focus();

  label.set('two');

  const nextInput = host._children[0];
  assert.notEqual(nextInput, input);
  assert.equal(document.activeElement, nextInput);
  assert.equal(nextInput.selectionStart, 1);
  assert.equal(nextInput.selectionEnd, 2);
  assert.equal(nextInput.value, 'two');
});
