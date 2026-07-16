// @ts-check
/** @typedef {{ __unsafeHTML: string }} UnsafeHTML */
/** @typedef {Node | UnsafeHTML | string | number | null | false | Array<Node | UnsafeHTML | string | number | null | false>} VNode */

/**
 * Explicit raw HTML escape hatch for narrowly reviewed markup such as syntax
 * highlighting. Prefer DOM nodes and text children for ordinary UI.
 * @param {string} html
 * @returns {UnsafeHTML}
 */
export function unsafeHTML(html) {
  return { __unsafeHTML: String(html) };
}

/**
 * Tags for which an undefined-custom-element check has already been
 * scheduled, so a given `cora-*` tag only ever warns once no matter how many
 * times `h()` is called for it.
 * @type {Set<string>}
 */
const scheduledUndefinedElementChecks = new Set();

/**
 * Dev-mode guard against the most junior-hostile failure mode in the repo:
 * rendering `h('cora-x', ...)` without a side-effect import of `cora-x.js`
 * creates an inert, unregistered element that fails silently. Warn once per
 * tag when that happens.
 *
 * The check is deferred to a microtask rather than run synchronously,
 * because `h()` can legitimately run before the module that defines the
 * element finishes `customElements.define()` in some import orders (e.g. a
 * component building its own children during its own module evaluation). By
 * the time the microtask runs, registration from the current synchronous
 * work has had a chance to complete, so only elements that are still
 * unregistered at that point are flagged.
 * @param {string} tag
 */
function warnIfUnregisteredCoraElement(tag) {
  if (!tag.startsWith('cora-')) return;
  if (scheduledUndefinedElementChecks.has(tag)) return;
  scheduledUndefinedElementChecks.add(tag);
  queueMicrotask(() => {
    if (customElements.get(tag) === undefined) {
      console.warn(
        `<${tag}> is not defined — missing a side-effect import of its module?`
      );
    }
  });
}

/**
 * A lightweight hyperscript-style element builder to replace manual document.createElement.
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...VNode} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  warnIfUnregisteredCoraElement(tag);
  const el = document.createElement(tag);

  // SharePoint hosts the whole app inside a page-wide <form>, so a <button>
  // with no explicit type (which defaults to type="submit") triggers a
  // full-page postback on every click. Default buttons to type="button" so
  // they behave as plain buttons; an explicit `type` prop below still wins.
  if (tag.toLowerCase() === 'button' && props.type == null) {
    el.setAttribute('type', 'button');
  }

  // A form control's `value` can only be applied *after* its children exist —
  // setting `<select>.value` before its `<option>`s are appended is a no-op in a
  // real browser (the value silently resets to the first option). Defer it.
  let deferredValue;
  let hasDeferredValue = false;

  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'innerHTML') {
      throw new Error(
        'h() does not accept innerHTML; use unsafeHTML() explicitly'
      );
    }
    if (k.startsWith('on') && typeof v === 'function') {
      // Component callback props (props-down / callbacks-up, issue #382):
      // a camelCase `on[A-Z]…` key that matches a property the element
      // declares (e.g. a custom-element shell's `onCommit` field) is a plain
      // callback, assigned as a property. Native handler IDL attributes are
      // all-lowercase (`onclick`), so they never match `/^on[A-Z]/` + `in el`
      // and keep flowing to addEventListener, as do camelCase keys on plain
      // elements (`onClick` on a <button>).
      if (/^on[A-Z]/.test(k) && k in el) {
        /** @type {any} */ (el)[k] = v;
      } else {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      }
    } else if (k === 'class' || k === 'className') {
      el.className = v;
    } else if (k === 'value' && 'value' in el) {
      deferredValue = v;
      hasDeferredValue = true;
    } else if (k in el) {
      // Properties like 'checked', 'disabled'
      /** @type {any} */ (el)[k] = v;
    } else {
      // Custom attributes like 'aria-required'
      el.setAttribute(k, String(v));
    }
  }

  const append = (/** @type {any} */ child) => {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      for (const c of child) append(c);
    } else if (
      child &&
      typeof child === 'object' &&
      typeof child.__unsafeHTML === 'string'
    ) {
      el.innerHTML = child.__unsafeHTML;
    } else if (child && typeof child === 'object' && 'appendChild' in child) {
      el.appendChild(/** @type {Node} */ (child));
    } else {
      if (document.createTextNode) {
        el.appendChild(document.createTextNode(String(child)));
      } else {
        const textStub = document.createElement('text');
        textStub.textContent = String(child);
        el.appendChild(textStub);
      }
    }
  };

  if (
    children.length === 1 &&
    (typeof children[0] === 'string' || typeof children[0] === 'number')
  ) {
    el.textContent = String(children[0]);
  } else {
    append(children);
  }

  // Apply `value` last so `<select>` matches against options that now exist.
  if (hasDeferredValue) {
    /** @type {any} */ (el).value = deferredValue;
  }

  return el;
}

/**
 * Fragment primitive for returning multiple elements
 * @param {Record<string, any>} _props
 * @param {...VNode} children
 * @returns {DocumentFragment}
 */
export function Fragment(_props, ...children) {
  const frag = document.createDocumentFragment();
  const append = (/** @type {any} */ child) => {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      for (const c of child) append(c);
    } else if (child && typeof child === 'object' && 'appendChild' in child) {
      frag.appendChild(/** @type {Node} */ (child));
    } else {
      frag.appendChild(document.createTextNode(String(child)));
    }
  };
  append(children);
  return frag;
}
