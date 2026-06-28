// @ts-check
// TODO(simplify-ui): Rewrite these lifecycle-heavy tests around the
// future function-component API. Prefer asserting plain functions, h() output,
// reactive() updates, and route-shell behavior over manual connectedCallback()/
// disconnectedCallback() calls on custom element classes.

/**
 * Shared DOM stub for tests of `cr-*` Question Bank components.
 *
 * Each test file should:
 *   1. `import { installDom } from './_bank-dom-stub.js';`
 *   2. Call `installDom()` *before* importing any component module so the
 *      module-eval-time `customElements.define()` calls don't blow up.
 *
 * The stub is intentionally minimal — enough for the components and the
 * focus-preservation in commit() to work, not a full DOM emulation.
 */

export class StubEl {
  constructor(tag = '') {
    this.tagName = tag.toUpperCase();
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
    this.id = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.type = '';
    this.name = '';
    this.hidden = false;
    this.style = {
      cssText: '',
      set height(_) {},
      get height() {
        return '';
      },
    };
    this.scrollHeight = 24;
    this.selectionStart = 0;
    this.selectionEnd = 0;
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
  setAttribute(/** @type {string} */ k, /** @type {any} */ v) {
    this._attrs[k] = String(v);
  }
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
  dispatchEvent(/** @type {any} */ _e) {
    return true;
  }
  setSelectionRange(/** @type {number} */ a, /** @type {number} */ b) {
    this.selectionStart = a;
    this.selectionEnd = b;
  }
  focus() {
    /** @type {any} */ (globalThis)._lastFocused = this;
    /** @type {any} */ (globalThis).document._active = this;
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

/** @param {StubEl} root @param {(n: StubEl) => boolean} pred @returns {StubEl | null} */
function findFirst(root, pred) {
  for (const c of root._children) {
    if (pred(c)) return c;
    const found = findFirst(c, pred);
    if (found) return found;
  }
  return null;
}
/** @param {StubEl} root @param {(n: StubEl) => void} fn */
function walk(root, fn) {
  for (const c of root._children) {
    fn(c);
    walk(c, fn);
  }
}
/** @param {StubEl} n @param {string} sel */
function matches(n, sel) {
  if (sel.startsWith('[data-focus-key=')) {
    const want = sel.slice('[data-focus-key="'.length, -2);
    return n.getAttribute('data-focus-key') === want;
  }
  if (sel.startsWith('.'))
    return n.className.split(/\s+/).includes(sel.slice(1));
  if (sel.startsWith('#')) return n.id === sel.slice(1);
  return n.tagName === sel.toUpperCase();
}

let installed = false;

export function installDom() {
  if (installed) return;
  installed = true;
  const G = /** @type {any} */ (globalThis);
  G.HTMLElement = StubEl;
  G.document = {
    _active: null,
    get activeElement() {
      return this._active;
    },
    /** @param {string} tag */
    createElement(tag) {
      const cls = G.customElements?._registry?.[tag];
      if (cls) return new cls();
      return new StubEl(tag);
    },
    createTextNode(/** @type {string} */ s) {
      const n = new StubEl('#text');
      n.textContent = s;
      return n;
    },
    /** @param {string} _sel */
    querySelector(_sel) {
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  G.customElements = {
    /** @type {Record<string, any>} */
    _registry: {},
    define(/** @type {string} */ name, /** @type {any} */ cls) {
      this._registry[name] = cls;
    },
  };
  G.CSS = { escape: (/** @type {string} */ s) => s };
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
