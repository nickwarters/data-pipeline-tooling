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
 * Records the raw props object each `h()`-built element was created with, so
 * `morph()` (src/core/morph.js) can diff the *authored* props of the previous
 * and next trees rather than trying to read them back out of the live DOM
 * (attribute enumeration and attached listeners are not portably
 * introspectable). This is bookkeeping only — it does not change how `h()` is
 * called. See ADR-0034 (store-driven views) / CORE-2.
 * @type {WeakMap<object, Record<string, any>>}
 */
const NODE_PROPS = new WeakMap();

/**
 * The props `h()` recorded for an element, or `undefined` for a node `h()`
 * never built (e.g. a text node, or an element from raw `createElement`).
 * @param {object} el
 * @returns {Record<string, any> | undefined}
 */
export function getProps(el) {
  return NODE_PROPS.get(el);
}

/**
 * Overwrite the recorded props for an element. `morph()` calls this after it
 * patches a kept node so the *next* diff compares against what is now live.
 * @param {object} el
 * @param {Record<string, any>} props
 */
export function setProps(el, props) {
  NODE_PROPS.set(el, props);
}

/**
 * Apply one authored prop to an element, mapping it to the right DOM channel
 * (event listener, callback property, className, value/other property, or a
 * plain attribute). This is the single source of truth for that mapping: `h()`
 * uses it at build time and `morph()` reuses it when a prop changes, so the two
 * can never drift. `value` is applied directly here; `h()` defers *when* it
 * calls this (see below), not *how*.
 * @param {any} el
 * @param {string} key
 * @param {any} value
 */
export function applyProp(el, key, value) {
  if (key === 'innerHTML') {
    throw new Error(
      'h() does not accept innerHTML; use unsafeHTML() explicitly'
    );
  }
  if (key.startsWith('on') && typeof value === 'function') {
    // Component callback props (props-down / callbacks-up, issue #382):
    // a camelCase `on[A-Z]…` key that matches a property the element declares
    // (e.g. a custom-element shell's `onCommit` field) is a plain callback,
    // assigned as a property. Native handler IDL attributes are all-lowercase
    // (`onclick`), so they never match `/^on[A-Z]/` + `in el` and keep flowing
    // to addEventListener, as do camelCase keys on plain elements (`onClick` on
    // a <button>).
    if (/^on[A-Z]/.test(key) && key in el) {
      el[key] = value;
    } else {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    }
  } else if (key === 'class' || key === 'className') {
    el.className = value;
  } else if (key === 'value' && 'value' in el) {
    el.value = value;
  } else if (key in el) {
    // Properties like 'checked', 'disabled'
    el[key] = value;
  } else {
    // Custom attributes like 'aria-required'
    el.setAttribute(key, String(value));
  }
}

/**
 * Undo an authored prop — the exact inverse of {@link applyProp}, for when a
 * prop present on the previous tree is gone (or is a listener being replaced)
 * on the next one. Removing a listener needs the *previous* handler reference,
 * which is why `morph()` diffs recorded props rather than the live node.
 * @param {any} el
 * @param {string} key
 * @param {any} prevValue - the value {@link applyProp} last set for this key
 */
export function removeProp(el, key, prevValue) {
  if (key === 'innerHTML') return;
  if (key.startsWith('on') && typeof prevValue === 'function') {
    if (/^on[A-Z]/.test(key) && key in el) {
      el[key] = null;
    } else {
      el.removeEventListener(key.slice(2).toLowerCase(), prevValue);
    }
  } else if (key === 'class' || key === 'className') {
    el.className = '';
  } else if (key === 'value' && 'value' in el) {
    el.value = '';
  } else if (key in el) {
    // There is no generic IDL-property reset primitive. Use the neutral value
    // for the authored type; callers that need a property-specific default
    // should author it explicitly on the next tree.
    el[key] =
      typeof prevValue === 'boolean'
        ? false
        : typeof prevValue === 'number'
          ? 0
          : '';
  } else {
    el.removeAttribute(key);
  }
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
    if (k === 'value' && 'value' in el) {
      deferredValue = v;
      hasDeferredValue = true;
      continue;
    }
    applyProp(el, k, v);
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
    applyProp(el, 'value', deferredValue);
  }

  // Record the authored props so morph() can diff them on the next render.
  NODE_PROPS.set(el, { ...props });

  return el;
}
