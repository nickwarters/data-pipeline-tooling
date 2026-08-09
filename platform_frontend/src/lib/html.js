// @ts-check
/** @typedef {{ __unsafeHTML: string }} UnsafeHTML */
/** @typedef {Node | UnsafeHTML | string | number | null | false | Array<Node | UnsafeHTML | string | number | null | false>} VNode */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

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
 * Append view children using the same text and explicit raw-markup handling
 * for both HTML and SVG builders.
 * @param {any} el
 * @param {VNode[]} children
 */
function appendChildren(el, children) {
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
}

/**
 * Keep render()'s controlled-form path attribute-backed for SVG nodes. SVG
 * does not have HTML form properties, but render() still owns these two keys.
 * @param {any} el
 */
function defineSvgFormProps(el) {
  Object.defineProperties(el, {
    value: {
      configurable: true,
      get: () => el.getAttribute('value') ?? '',
      set: (/** @type {any} */ value) => {
        el.setAttribute('value', String(value));
      },
    },
    checked: {
      configurable: true,
      get: () => el.getAttribute('checked') === 'true',
      set: (/** @type {any} */ value) => {
        el.setAttribute('checked', String(Boolean(value)));
      },
    },
  });
}

/**
 * Records the raw props object each view-builder-built element was created with,
 * so `render()` (src/core/render.js) can diff the *authored* props of the previous
 * and next trees rather than trying to read them back out of the live DOM
 * (attribute enumeration and attached listeners are not portably
 * introspectable). This is bookkeeping only — it does not change how `h()` or
 * `svg()` is called.
 * @type {WeakMap<object, Record<string, any>>}
 */
const NODE_PROPS = new WeakMap();

/**
 * The props a view builder recorded for an element, or `undefined` for a node
 * no view builder built (e.g. a text node, or an element from raw
 * `createElement`).
 * @param {object} el
 * @returns {Record<string, any> | undefined}
 */
export function getProps(el) {
  return NODE_PROPS.get(el);
}

/**
 * Overwrite the recorded props for an element. `render()` calls this after it
 * patches a kept node so the *next* diff compares against what is now live.
 * @param {object} el
 * @param {Record<string, any>} props
 */
export function setProps(el, props) {
  // The controlled-form path writes these two keys directly; absent SVG props
  // still need their attributes removed after that path runs.
  if (el.namespaceURI === SVG_NAMESPACE) {
    if (props.value == null) el.removeAttribute('value');
    if (props.checked == null) el.removeAttribute('checked');
  }
  NODE_PROPS.set(el, props);
}

/**
 * Prop naming, in two rules:
 *
 *   onclick / oninput / onchange …  → DOM events, via addEventListener
 *   className (never `class`)       → the class attribute
 *
 * camelCase `on[A-Z]` keys are the *component* callback convention (`onAnswer`,
 * `onSort`): a view function reads them off its own props object, so they never
 * reach an element. Handing one to `h()` is therefore always a mistake — it
 * would bind a listener for an event nothing dispatches.
 *
 * `class` is rejected for a different reason. It would work — it lands on the
 * class attribute either way — and that is the problem: a synonym that behaves
 * identically is a thing to look up rather than know, and nothing would ever
 * force a choice between the two. One spelling, enforced.
 *
 * Both are enforced by `applyProp` throwing, so the mistake surfaces at the call
 * site that made it. Neither check tests the *value*: `onAnswer: undefined` is
 * the same authoring error as `onAnswer: fn`, and silently setting an
 * `onAnswer=""` attribute would be a worse outcome than the throw.
 */

/**
 * Apply one authored prop to an element, mapping it to the right DOM channel
 * (event listener, className, value/other property, or a plain attribute).
 * This is the single source of truth for that mapping: `h()` and `svg()` use it
 * at build time and `render()` reuses it when a prop changes, so the two can
 * never drift.
 * `value` is applied directly here; `h()` defers *when* it calls this (see
 * below), not *how*.
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
  if (/^on[A-Z]/.test(key)) {
    throw new Error(
      `h() does not accept the component callback prop "${key}"; DOM events are lowercase (${key.toLowerCase()})`
    );
  }
  if (key === 'class') {
    throw new Error('h() does not accept "class"; the class prop is className');
  }
  if (key.startsWith('on') && typeof value === 'function') {
    el.addEventListener(key.slice(2).toLowerCase(), value);
  } else if (el.namespaceURI === SVG_NAMESPACE) {
    el.setAttribute(key === 'className' ? 'class' : key, String(value));
  } else if (key === 'className') {
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
 * which is why `render()` diffs recorded props rather than the live node.
 * @param {any} el
 * @param {string} key
 * @param {any} prevValue - the value {@link applyProp} last set for this key
 */
export function removeProp(el, key, prevValue) {
  if (key === 'innerHTML') return;
  if (key.startsWith('on') && typeof prevValue === 'function') {
    el.removeEventListener(key.slice(2).toLowerCase(), prevValue);
  } else if (el.namespaceURI === SVG_NAMESPACE) {
    el.removeAttribute(key === 'className' ? 'class' : key);
  } else if (key === 'className') {
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

  appendChildren(el, children);

  // Apply `value` last so `<select>` matches against options that now exist.
  if (hasDeferredValue) {
    applyProp(el, 'value', deferredValue);
  }

  // Record the authored props so render() can diff them on the next render.
  NODE_PROPS.set(el, { ...props });

  return el;
}

/**
 * Build an SVG element in the SVG namespace.
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...VNode} children
 * @returns {SVGElement}
 */
export function svg(tag, props = {}, ...children) {
  const el = document.createElementNS(SVG_NAMESPACE, tag);
  defineSvgFormProps(el);

  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    applyProp(el, k, v);
  }

  appendChildren(el, children);
  NODE_PROPS.set(el, { ...props });
  return el;
}
