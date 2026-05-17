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
const { CRReportsIndex } = await import('../src/pages/cr-reports-index.js');

/** @returns {import('../src/services/permissions.js').Capabilities} */
function managerCaps() {
  return { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: true };
}

/** @returns {import('../src/services/permissions.js').Capabilities} */
function nonManagerCaps() {
  return { isReviewer: false, ownedCaseTypes: [], isResponsibleParty: false, isReviewerManager: false };
}

/** @param {any} node @param {string} text @returns {boolean} */
function hasText(node, text) {
  if (typeof node.textContent === 'string' && node.textContent.includes(text)) return true;
  for (const c of node._children ?? []) {
    if (hasText(c, text)) return true;
  }
  return false;
}

/** @param {any} node @param {string} href @returns {any|null} */
function findLink(node, href) {
  if (node.tagName === 'A' && node.href === href) return node;
  for (const c of node._children ?? []) {
    const found = findLink(c, href);
    if (found) return found;
  }
  return null;
}

test('cr-reports-index: reviewer manager sees Reviewer Team Performance card', () => {
  const el = new CRReportsIndex();
  el.capabilities = managerCaps();
  el.connectedCallback();
  assert.ok(hasText(el, 'Reviewer Team Performance'), 'should render card title');
});

test('cr-reports-index: reviewer manager card links to #/reports/reviewer-team', () => {
  const el = new CRReportsIndex();
  el.capabilities = managerCaps();
  el.connectedCallback();
  const link = findLink(el, '#/reports/reviewer-team');
  assert.ok(link, 'should render link to #/reports/reviewer-team');
});

test('cr-reports-index: non-manager sees empty-state message', () => {
  const el = new CRReportsIndex();
  el.capabilities = nonManagerCaps();
  el.connectedCallback();
  assert.ok(hasText(el, "You don't have access to any reports"), 'should render empty-state');
});

test('cr-reports-index: non-manager does not see Reviewer Team Performance card', () => {
  const el = new CRReportsIndex();
  el.capabilities = nonManagerCaps();
  el.connectedCallback();
  assert.ok(!hasText(el, 'Reviewer Team Performance'), 'should not render card for non-manager');
});
