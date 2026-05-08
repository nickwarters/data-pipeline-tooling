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
    /** @type {string} */
    this.tagName = '';
    this.textContent = '';
    this.className = '';
    this.href = '';
    this.hidden = false;
    /** @type {any} */
    this.client = null;
    /** @type {string} */
    this.currentUserId = '';
    /** @type {string[]} */
    this.eligibleCaseTypes = [];
    /** @type {string[]} */
    this.ownedCaseTypes = [];
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
}

(/** @type {any} */ (globalThis)).HTMLElement = StubEl;
(/** @type {any} */ (globalThis)).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
};
(/** @type {any} */ (globalThis)).customElements = { define() {} };
(/** @type {any} */ (globalThis)).location = { hash: '' };

// ===== IMPORTS (after stubs) =====
const { CRDashboard } = await import('../src/cr-dashboard.js');

// ===== HELPERS =====
function makeClient() {
  return {
    async listCases() { return []; },
  };
}

/**
 * Find every descendant element whose tagName matches.
 * @param {any} root
 * @param {string} tagName
 * @returns {StubEl[]}
 */
function findAll(root, tagName) {
  /** @type {StubEl[]} */
  const out = [];
  /** @param {StubEl} n */
  function walk(n) {
    if (n.tagName === tagName.toUpperCase()) out.push(n);
    for (const c of n._children) walk(c);
  }
  walk(root);
  return out;
}

/** @param {any} root */
function hasOutstandingCasesHeading(root) {
  return findAll(root, 'h1').some(h => h.textContent === 'Outstanding Cases');
}

// ===== TESTS =====

test('CRDashboard: reviewer capability — outstanding Cases heading and allocation visible, no owner summary', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-reviewer';
  el.capabilities = { isReviewer: true, ownedCaseTypes: [] };
  el.eligibleCaseTypes = ['hello-review'];

  await el.connectedCallback();

  assert.equal(hasOutstandingCasesHeading(el), true, 'should render Outstanding Cases heading');
  assert.equal(findAll(el, 'cr-allocation').length, 1, 'should render allocation button');
  assert.equal(findAll(el, 'cr-owner-summary').length, 0, 'should NOT render owner summary');
});

test('CRDashboard: owner-only capability — owner summary visible, no outstanding Cases, no allocation', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-owner';
  el.capabilities = { isReviewer: false, ownedCaseTypes: ['hello-review'] };
  el.eligibleCaseTypes = [];

  await el.connectedCallback();

  assert.equal(hasOutstandingCasesHeading(el), false, 'should NOT render Outstanding Cases heading');
  assert.equal(findAll(el, 'cr-allocation').length, 0, 'should NOT render allocation button');
  assert.equal(findAll(el, 'cr-owner-summary').length, 1, 'should render owner summary');
});

test('CRDashboard: admin capability — both reviewer and owner sections visible', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-admin';
  el.capabilities = { isReviewer: true, ownedCaseTypes: ['hello-review'] };
  el.eligibleCaseTypes = ['hello-review'];

  await el.connectedCallback();

  assert.equal(hasOutstandingCasesHeading(el), true, 'should render Outstanding Cases heading');
  assert.equal(findAll(el, 'cr-allocation').length, 1, 'should render allocation button');
  assert.equal(findAll(el, 'cr-owner-summary').length, 1, 'should render owner summary');
});

test('CRDashboard: reviewer with no ownedCaseTypes never renders owner section (no error)', async () => {
  const el = new CRDashboard();
  el.client = /** @type {any} */ (makeClient());
  el.currentUserId = 'user-reviewer';
  el.capabilities = { isReviewer: true, ownedCaseTypes: [] };
  el.eligibleCaseTypes = ['hello-review'];

  // Must not throw.
  await el.connectedCallback();

  assert.equal(findAll(el, 'cr-owner-summary').length, 0);
});

test('CRDashboard: connectedCallback does nothing when client is null', async () => {
  const el = new CRDashboard();
  el.client = null;
  await el.connectedCallback();
  assert.equal((/** @type {any} */ (el))._children.length, 0);
});
