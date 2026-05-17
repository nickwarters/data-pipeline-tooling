// @ts-check
/**
 * Shared DOM helpers for the Question Bank components.
 *
 * `el(tag, props, ...kids)` — terse element builder. Accepts:
 *   - `class`           → assigns to className
 *   - `style` (string)  → cssText
 *   - `on*`             → addEventListener
 *   - `html`            → innerHTML (template strings only — never user data)
 *   - anything else     → setAttribute (skipped when value is null/undefined)
 * Children may be strings (text nodes), elements, arrays, or falsy (skipped).
 *
 * `reactive(host, render)` — runs `render()` once and again whenever any
 * signal it reads changes. The disposer is pushed onto `host._disposes` so
 * CRElement's `disconnectedCallback` tears it down automatically.
 */

import { effect } from './signal.js';

/**
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param  {...(Node|string|false|null|undefined|Array<Node|string|false|null|undefined>)} kids
 * @returns {any}
 */
export function el(tag, props = {}, ...kids) {
  const e = /** @type {any} */ (document.createElement(tag));
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'string') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return e;
}

/**
 * @param {{ _disposes: Array<() => void> }} host
 * @param {() => void} render
 */
export function reactive(host, render) {
  host._disposes.push(effect(() => render()));
}
