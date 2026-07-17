// @ts-check
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

/** @type {Set<() => void>} */
const domMutationObservers = new Set();

function notifyDomMutation() {
  for (const observer of [...domMutationObservers]) observer();
}

/**
 * Shared DOM stub for tests of `cora-*` components and route modules.
 *
 * Each test file should:
 *   1. `import { installDom, StubEl } from './_dom-stub.js';`
 *   2. Call `installDom()` *before* importing any component module so the
 *      module-eval-time `customElements.define()` calls don't blow up.
 *
 * The stub is intentionally minimal — enough for the components under test
 * to render and handle events, not a full DOM emulation. Tests that need
 * extra typed properties on an element (e.g. a fake `<cora-case-table>` with a
 * `client` property) should declare a local subclass of `StubEl`.
 */

export class StubEl {
  constructor(tag = '') {
    this.tagName = tag.toUpperCase();
    /** Raw tag name as passed to `document.createElement`. */
    this._tagName = tag;
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {Record<string, string>} */
    this._attrs = {};
    /** @type {StubEl|null} */
    this.parentNode = null;
    this.textContent = '';
    this.className = '';
    this.innerHTML = '';
    /** @type {any} */
    this._value = '';
    this.checked = false;
    this.disabled = false;
    this.readOnly = false;
    this.hidden = false;
    this._focused = false;
    /** @type {{ preventScroll?: boolean } | undefined} */
    this._focusOptions = undefined;
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Record<string, string>} */
    this.style = { cssText: '' };
    this.scrollHeight = 24;
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }
  // Attribute-reflected properties, mirroring the real DOM: setting the
  // property is visible through getAttribute() and vice versa, so tests can
  // assert on either without caring which path `h()` took.
  get value() {
    return this._value;
  }
  set value(v) {
    this._value = v;
  }
  get id() {
    return this._attrs['id'] ?? '';
  }
  set id(v) {
    this._attrs['id'] = String(v);
  }
  get role() {
    return this._attrs['role'] ?? '';
  }
  set role(v) {
    this._attrs['role'] = String(v);
  }
  get tabIndex() {
    const v = this._attrs['tabindex'];
    return v == null ? 0 : Number(v);
  }
  set tabIndex(v) {
    this._attrs['tabindex'] = String(v);
  }
  get href() {
    return this._attrs['href'] ?? '';
  }
  set href(v) {
    this._attrs['href'] = String(v);
  }
  get title() {
    return this._attrs['title'] ?? '';
  }
  set title(v) {
    this._attrs['title'] = String(v);
  }
  get name() {
    return this._attrs['name'] ?? '';
  }
  set name(v) {
    this._attrs['name'] = String(v);
  }
  get type() {
    return this._attrs['type'] ?? '';
  }
  set type(v) {
    this._attrs['type'] = String(v);
  }
  get placeholder() {
    return this._attrs['placeholder'] ?? '';
  }
  set placeholder(v) {
    this._attrs['placeholder'] = String(v);
  }
  get childElementCount() {
    return this._children.filter((child) => child.tagName !== '#text').length;
  }
  appendChild(/** @type {StubEl} */ c) {
    c.parentNode = this;
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    for (const c of cs) this.appendChild(c);
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    for (const c of this._children) c.parentNode = null;
    this._children = [];
    for (const c of cs) this.appendChild(c);
    notifyDomMutation();
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  removeEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    const list = this._listeners[t];
    if (!list) return;
    const i = list.indexOf(h);
    if (i >= 0) list.splice(i, 1);
  }
  /** Fires listeners on this element, then bubbles if `e.bubbles`. */
  dispatchEvent(/** @type {any} */ e) {
    e.target ??= this;
    /** @type {StubEl|null} */
    let n = this;
    while (n) {
      for (const h of [...(n._listeners[e.type] ?? [])]) h(e);
      n = e.bubbles ? n.parentNode : null;
    }
    return true;
  }
  /** Fire a registered listener as if the user triggered it. */
  _fire(/** @type {string} */ ev, /** @type {any} */ payload) {
    for (const h of [...(this._listeners[ev] ?? [])]) h(payload);
  }
  setAttribute(/** @type {string} */ k, /** @type {any} */ v) {
    this._attrs[k] = String(v);
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
  removeAttribute(/** @type {string} */ k) {
    delete this._attrs[k];
  }
  setSelectionRange(/** @type {number} */ a, /** @type {number} */ b) {
    this.selectionStart = a;
    this.selectionEnd = b;
  }
  /** @param {{ preventScroll?: boolean }} [options] */
  focus(options) {
    this._focused = true;
    this._focusOptions = options;
    const G = /** @type {any} */ (globalThis);
    G._lastFocused = this;
    if (G.document) G.document._active = this;
  }
  blur() {
    this._focused = false;
  }
  /** @returns {StubEl|null} */
  querySelector(/** @type {string} */ sel) {
    return findFirst(this, (n) => matches(n, sel));
  }
  /** @returns {StubEl[]} */
  querySelectorAll(/** @type {string} */ sel) {
    /** @type {StubEl[]} */
    const out = [];
    walk(this, (n) => {
      if (matches(n, sel)) out.push(n);
    });
    return out;
  }
  scrollIntoView() {}
  closest(/** @type {string} */ sel) {
    /** @type {StubEl|null} */
    let n = this;
    while (n) {
      if (matches(n, sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
  cloneNode() {
    return new StubEl(this.tagName);
  }
}

/**
 * StubEl variant that mimics custom-element upgrade: inserting a child calls
 * its `connectedCallback()`, so registered components render when a parent
 * appends them. Use with `useElementClass(ConnectingStubEl, { registry: true })`.
 */
export class ConnectingStubEl extends StubEl {
  appendChild(/** @type {StubEl} */ c) {
    super.appendChild(c);
    /** @type {any} */ (c).connectedCallback?.();
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    for (const c of cs) this.appendChild(c);
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    super.replaceChildren(...cs);
    for (const c of cs) /** @type {any} */ (c).connectedCallback?.();
  }
}

export class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any, bubbles?: boolean }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
    this.bubbles = init?.bubbles ?? false;
    /** @type {any} */
    this.target = null;
    this.defaultPrevented = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
}

/** @param {StubEl} root @param {(n: StubEl) => boolean} pred @returns {StubEl | null} */
function findFirst(root, pred) {
  for (const c of root._children) {
    if (pred(c)) return c;
    const found = findFirst(c, pred);
    if (found) return found;
  }
  return null;
}

/**
 * Depth-first walk of an element's descendants (not the root itself).
 * @param {StubEl} root @param {(n: StubEl) => void} fn
 */
export function walk(root, fn) {
  for (const c of root._children ?? []) {
    fn(c);
    walk(c, fn);
  }
}

/** @param {StubEl} n @param {string} sel */
function matches(n, sel) {
  const attrMatch = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attrMatch) return n.getAttribute(attrMatch[1]) === attrMatch[2];
  if (sel.startsWith('.'))
    return n.className.split(/\s+/).includes(sel.slice(1));
  if (sel.startsWith('#')) return n.id === sel.slice(1);
  return n.tagName === sel.toUpperCase();
}

/**
 * Find the first descendant whose full `className` equals `cls`.
 * @param {any} root @param {string} cls @returns {any}
 */
export function findByClass(root, cls) {
  for (const c of root._children ?? []) {
    if (c.className === cls) return c;
    const nested = findByClass(c, cls);
    if (nested) return nested;
  }
  return null;
}

/**
 * Find all descendants whose full `className` equals `cls`.
 * @param {any} root @param {string} cls @returns {any[]}
 */
export function findAllByClass(root, cls) {
  /** @type {any[]} */
  const out = [];
  for (const c of root._children ?? []) {
    if (c.className === cls) out.push(c);
    out.push(...findAllByClass(c, cls));
  }
  return out;
}

/**
 * Find the first descendant with the given tag name.
 * @param {any} root @param {string} tag @returns {any}
 */
export function findByTag(root, tag) {
  const want = tag.toUpperCase();
  for (const c of root._children ?? []) {
    if (c.tagName === want) return c;
    const nested = findByTag(c, tag);
    if (nested) return nested;
  }
  return null;
}

/** Flush a couple of microtask turns so post-async renders have happened. */
export async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Wait until an observable test condition becomes true. The predicate is
 * checked immediately and after every stub-DOM render, so success is driven by
 * the state the test cares about rather than a delay or a production-only
 * promise registry. The timer only bounds a broken test; it never settles a
 * successful one.
 *
 * @param {() => boolean} predicate
 * @param {string} [description]
 * @returns {Promise<void>}
 */
export function waitFor(predicate, description = 'DOM condition') {
  if (predicate()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      domMutationObservers.delete(check);
    };
    const check = () => {
      if (!predicate()) return;
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${description}`));
    }, 5000);

    domMutationObservers.add(check);
  });
}

/**
 * Wait for a reactive host to replace its current children. Capture happens at
 * the call site, so synchronous setup is ignored and the next render is the
 * completion event. Prefer `waitFor()` when the expected state is clearer than
 * a render boundary.
 *
 * @param {HTMLElement} host
 * @returns {Promise<void>}
 */
export function waitForRender(host) {
  const stub = /** @type {StubEl} */ (/** @type {unknown} */ (host));
  const children = stub._children;
  return waitFor(
    () => stub._children !== children,
    `${stub._tagName || stub.tagName || 'host'} to render`
  );
}

/**
 * Route `document.createElement` (and `HTMLElement`) through a custom StubEl
 * subclass, for tests that need extra behaviour on every created element
 * (e.g. recording `update()` calls from a parent component). Every created
 * element uses the subclass — by default registered custom element
 * constructors are ignored, so child `cora-*` tags render as inert stubs;
 * pass `{ registry: true }` to keep instantiating registered constructors.
 * Call after `installDom()` and before importing component modules.
 * @param {typeof StubEl} cls
 * @param {{ registry?: boolean }} [opts]
 */
export function useElementClass(cls, opts = {}) {
  const G = /** @type {any} */ (globalThis);
  G.HTMLElement = cls;
  G.document.createElement = (/** @type {string} */ tag) => {
    const Ctor =
      (opts.registry && G.customElements._registry[tag.toLowerCase()]) || cls;
    const el = new Ctor(tag);
    el.tagName = tag.toUpperCase();
    el._tagName = tag;
    return el;
  };
}

let installed = false;

export function installDom() {
  if (installed) return;
  installed = true;
  isolateBrowserGlobals();
  const G = /** @type {any} */ (globalThis);
  G.HTMLElement = StubEl;
  G.CustomEvent = StubCustomEvent;
  G.document = {
    _active: null,
    hidden: false,
    get activeElement() {
      return this._active;
    },
    /** @param {string} tag */
    createElement(tag) {
      const cls = G.customElements?._registry?.[tag.toLowerCase()];
      const el = cls ? new cls() : new StubEl(tag);
      el.tagName = tag.toUpperCase();
      el._tagName = tag;
      return el;
    },
    createTextNode(/** @type {string} */ s) {
      const n = new StubEl('#text');
      n.tagName = '#text';
      n._tagName = '#text';
      n.textContent = s;
      return n;
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
    /** @param {string} _sel */
    querySelector(_sel) {
      return null;
    },
    /** @type {Record<string, Function[]>} */
    _listeners: {},
    addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
      (this._listeners[t] ??= []).push(h);
    },
    removeEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
      this._listeners[t] = (this._listeners[t] ?? []).filter(
        (/** @type {Function} */ fn) => fn !== h
      );
    },
    dispatchEvent(/** @type {any} */ event) {
      event.target ??= this;
      for (const handler of [...(this._listeners[event.type] ?? [])]) {
        handler(event);
      }
      return true;
    },
    /** Fire document-level listeners as if the user triggered the event. */
    _fire(/** @type {string} */ t, /** @type {any} */ ev) {
      for (const h of [...(this._listeners[t] ?? [])]) h(ev);
    },
  };
  if (!G.window) {
    G.window = { addEventListener() {}, removeEventListener() {} };
  }
  G.customElements = {
    /** @type {Record<string, any>} */
    _registry: {},
    /** @type {Array<[string, any]>} */
    _defined: [],
    define(/** @type {string} */ name, /** @type {any} */ cls) {
      this._registry[name.toLowerCase()] = cls;
      this._defined.push([name, cls]);
    },
    /** @param {string} name */
    get(name) {
      return this._registry[name.toLowerCase()];
    },
  };
  G.CSS = { escape: (/** @type {string} */ s) => s };
  if (!G.location) G.location = { hash: '' };
  if (!G.crypto?.subtle) {
    try {
      G.crypto = {
        subtle: {
          async digest() {
            return new ArrayBuffer(32);
          },
        },
      };
    } catch {
      /* read-only crypto on this runtime — fine, hashStr tests already cover it */
    }
  }
  if (!G.TextEncoder) {
    G.TextEncoder = class {
      encode(/** @type {string} */ s) {
        return new Uint8Array([...String(s)].map((c) => c.charCodeAt(0)));
      }
    };
  }
  G.requestAnimationFrame =
    G.requestAnimationFrame ??
    ((/** @type {Function} */ fn) => {
      fn();
      return 0;
    });
  G.confirm = G.confirm ?? (() => true);
  G.alert = G.alert ?? (() => {});
  G.prompt = G.prompt ?? (() => null);
  if (!G.navigator) {
    try {
      G.navigator = { clipboard: { writeText: async () => {} } };
    } catch {
      /* read-only on this runtime */
    }
  }
}
