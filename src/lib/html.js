// @ts-check

/**
 * A lightweight hyperscript-style element builder to replace manual document.createElement.
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param  {...(HTMLElement | string | Array<HTMLElement | string> | null | false)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);

  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class' || k === 'className') {
      el.className = v;
    } else if (k in el) {
      // Properties like 'checked', 'disabled', 'value'
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
    } else if (child && typeof child === 'object' && 'appendChild' in child) {
      el.appendChild(child);
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
  return el;
}

/**
 * Fragment primitive for returning multiple elements
 * @param {Record<string, any>} _props
 * @param  {...(HTMLElement | string | Array<HTMLElement | string> | null | false)} children
 * @returns {DocumentFragment}
 */
export function Fragment(_props, ...children) {
  const frag = document.createDocumentFragment();
  const append = (/** @type {any} */ child) => {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      for (const c of child) append(c);
    } else if (child && typeof child === 'object' && 'appendChild' in child) {
      frag.appendChild(child);
    } else {
      frag.appendChild(document.createTextNode(String(child)));
    }
  };
  append(children);
  return frag;
}
