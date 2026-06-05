// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====
class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {string} */
    this.tagName = '';
    this.textContent = '';
    this.className = '';
    this.href = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) { this._children = cs; }
  appendChild(/** @type {StubEl} */ c) { this._children.push(c); return c; }
  append(/** @type {StubEl[]} */ ...cs) { this._children.push(...cs); }
  setAttribute() {}
  addEventListener() {}
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
const { CRHome } = await import('../src/pages/cr-home.js');

// ===== HELPERS =====
const NONE = {
  isReviewer: false,
  ownedCaseTypes: /** @type {string[]} */ ([]),
  isResponsibleParty: false,
  isReviewerManager: false,
  isResponsiblePartyManager: false,
  isMaintainer: false,
  isVisitor: false,
};

/** @param {Partial<typeof NONE>} over */
function caps(over) { return { ...NONE, ...over }; }

/**
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

/** @param {any} root @returns {string[]} */
function sectionHeadings(root) {
  return findAll(root, 'section').map(s => {
    const h = findAll(s, 'h2')[0];
    return h ? h.textContent : '';
  });
}

/** @param {any} root @returns {string[]} */
function sectionLinks(root) {
  /** @type {string[]} */
  const out = [];
  for (const s of findAll(root, 'section')) {
    for (const a of findAll(s, 'a')) out.push(a.href);
  }
  return out;
}

// ===== TESTS =====

test('CRHome: visitor only — renders single Visitor section, no other roles', () => {
  const el = new CRHome();
  el.capabilities = caps({ isVisitor: true });
  el.connectedCallback();

  assert.deepEqual(sectionHeadings(el), ['Visitor']);
});

test('CRHome: visitor section has explainer text and a mailto access-request, no nav link', () => {
  const el = new CRHome();
  el.capabilities = caps({ isVisitor: true });
  el.connectedCallback();

  const links = findAll(el, 'a');
  const mailtos = links.filter(a => a.href.startsWith('mailto:'));
  assert.equal(mailtos.length, 1, 'one mailto access-request affordance');
  assert.equal(links.length, 1, 'no non-mailto nav link in visitor section');
  // explainer paragraph present
  assert.ok(findAll(el, 'p').length >= 1, 'visitor explainer text present');
});

test('CRHome: reviewer — single section linking to dashboard', () => {
  const el = new CRHome();
  el.capabilities = caps({ isReviewer: true });
  el.connectedCallback();

  assert.deepEqual(sectionHeadings(el), ['Reviewer']);
  assert.deepEqual(sectionLinks(el), ['#/dashboard']);
});

test('CRHome: reviewer manager — links to reviewer team report', () => {
  const el = new CRHome();
  el.capabilities = caps({ isReviewerManager: true });
  el.connectedCallback();

  assert.deepEqual(sectionHeadings(el), ['Reviewer Manager']);
  assert.deepEqual(sectionLinks(el), ['#/reports/reviewer-team']);
});

test('CRHome: responsible party manager — links to responsible party team report', () => {
  const el = new CRHome();
  el.capabilities = caps({ isResponsiblePartyManager: true });
  el.connectedCallback();

  assert.deepEqual(sectionHeadings(el), ['Responsible Party Manager']);
  assert.deepEqual(sectionLinks(el), ['#/reports/responsible-party-team']);
});

test('CRHome: responsible party — links to conversation', () => {
  const el = new CRHome();
  el.capabilities = caps({ isResponsibleParty: true });
  el.connectedCallback();

  assert.deepEqual(sectionHeadings(el), ['Responsible Party']);
  assert.deepEqual(sectionLinks(el), ['#/conversation']);
});

test('CRHome: case type owner — links to question bank', () => {
  const el = new CRHome();
  el.capabilities = caps({ ownedCaseTypes: ['hello-review'] });
  el.connectedCallback();

  assert.deepEqual(sectionHeadings(el), ['Case Type Owner']);
  assert.deepEqual(sectionLinks(el), ['#/question-bank']);
});

test('CRHome: maintainer — links to question bank', () => {
  const el = new CRHome();
  el.capabilities = caps({ isMaintainer: true });
  el.connectedCallback();

  assert.deepEqual(sectionHeadings(el), ['Maintainer']);
  assert.deepEqual(sectionLinks(el), ['#/question-bank']);
});

test('CRHome: multi-role — only matching sections, in documented order', () => {
  const el = new CRHome();
  el.capabilities = caps({
    isReviewer: true,
    isResponsiblePartyManager: true,
    ownedCaseTypes: ['hello-review'],
    isMaintainer: true,
  });
  el.connectedCallback();

  assert.deepEqual(sectionHeadings(el), [
    'Reviewer',
    'Responsible Party Manager',
    'Case Type Owner',
    'Maintainer',
  ]);
});

test('CRHome: full order — all roles render in documented order', () => {
  const el = new CRHome();
  el.capabilities = caps({
    isReviewer: true,
    isReviewerManager: true,
    isResponsiblePartyManager: true,
    isResponsibleParty: true,
    ownedCaseTypes: ['hello-review'],
    isMaintainer: true,
    isVisitor: true,
  });
  el.connectedCallback();

  assert.deepEqual(sectionHeadings(el), [
    'Reviewer',
    'Reviewer Manager',
    'Responsible Party Manager',
    'Responsible Party',
    'Case Type Owner',
    'Maintainer',
    'Visitor',
  ]);
});

test('CRHome: no capabilities set — renders nothing without throwing', () => {
  const el = new CRHome();
  el.connectedCallback();
  assert.deepEqual(sectionHeadings(el), []);
});
