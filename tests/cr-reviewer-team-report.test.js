// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, string>} */
    this._attrs = {};
    /** @type {string} */
    this.tagName = '';
    this.textContent = '';
    this.className = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener() {}
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = v; }
  getAttribute(/** @type {string} */ k) { return this._attrs[k] ?? null; }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  createElement(/** @type {string} */ tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };

const { CRReviewerTeamReport } = await import('../src/pages/cr-reviewer-team-report.js');

/** @param {any} node @param {string} text @returns {boolean} */
function hasText(node, text) {
  if (typeof node.textContent === 'string' && node.textContent.includes(text)) return true;
  for (const c of node._children ?? []) {
    if (hasText(c, text)) return true;
  }
  return false;
}

test('cr-reviewer-team-report: renders a heading', () => {
  const el = new CRReviewerTeamReport();
  el.connectedCallback();
  assert.ok(hasText(el, 'Reviewer Team Performance'), 'should render a heading');
});

test('cr-reviewer-team-report: renders a back link to #/reports', () => {
  const el = new CRReviewerTeamReport();
  el.connectedCallback();
  /** @param {any} node @param {string} href @returns {any|null} */
  function findLink(node, href) {
    if (node.tagName === 'A' && node._attrs['href'] === href) return node;
    for (const c of node._children ?? []) {
      const f = findLink(c, href);
      if (f) return f;
    }
    return null;
  }
  assert.ok(findLink(el, '#/reports'), 'should render back link to #/reports');
});
