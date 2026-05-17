// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {Record<string, string>} */
    this._attrs = {};
    /** @type {string} */
    this.tagName = '';
    this.textContent = '';
    this.className = '';
    this.href = '';
    this.hidden = false;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = v; }
  getAttribute(/** @type {string} */ k) { return this._attrs[k] ?? null; }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };

// ===== IMPORTS (after stubs) =====
const { CRAppNav } = await import('../src/components/cr-app-nav.js');

/** @param {any} node @param {string} href @returns {any|null} */
function findLink(node, href) {
  if (node.tagName === 'A' && node.href === href) return node;
  for (const c of node._children ?? []) {
    const found = findLink(c, href);
    if (found) return found;
  }
  return null;
}

test('cr-app-nav: reviewer manager sees #/reports link', () => {
  const el = new CRAppNav();
  el.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: true };
  el.connectedCallback();
  assert.ok(findLink(el, '#/reports'), 'should render link to #/reports');
});

test('cr-app-nav: non-manager does not see #/reports link', () => {
  const el = new CRAppNav();
  el.capabilities = { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false };
  el.connectedCallback();
  assert.equal(findLink(el, '#/reports'), null, 'should not render #/reports link');
});
