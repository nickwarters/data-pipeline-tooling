// @ts-check
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

// Minimal DOM stub for tests/view.test.js, split into its own module so it
// can be imported (and its globals installed) *before* src/lib/view.js is
// imported. view.js resolves its HTMLElement base class once at module-eval
// time (`globalThis.HTMLElement ?? class {}`); if globalThis.HTMLElement
// were set later in the same module as the view.js import, it would already
// be too late — ES module imports evaluate before the rest of that module's
// top-level code runs. Importing this module first guarantees the global is
// in place before view.js's own top-level code executes.
//
// This stub is deliberately separate from tests/_dom-stub.js: the view()
// primitive is exercised against real EventTarget dispatch semantics, which
// the shared StubEl does not model.

export class StubEl extends EventTarget {
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

  get childNodes() {
    return [...this._children];
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

  /** @param {{ preventScroll?: boolean }} [options] */
  focus(options) {
    this._focusOptions = options;
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
