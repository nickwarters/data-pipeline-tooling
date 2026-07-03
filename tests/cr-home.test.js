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
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  setAttribute() {}
  addEventListener() {}
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
};
/** @type {any} */ (globalThis).customElements = { define() {} };
/** @type {any} */ (globalThis).location = { hash: '' };

// ===== IMPORTS (after stubs) =====
const { HomePage } = await import('../src/pages/cr-home.js');

// ===== HELPERS =====
const NONE = {
  isReviewer: false,
  ownedCaseTypes: /** @type {string[]} */ ([]),
  isAdviser: false,
  isReviewerManager: false,
  isResponsiblePartyManager: false,
  isMaintainer: false,
  listAccessCaseTypes: [],
  ownedJourneyCaseTypes: /** @type {string[]} */ ([]),
  isControls: false,
  isVisitor: false,
};

/** @param {Partial<typeof NONE>} over */
function caps(over) {
  return { ...NONE, ...over };
}

/** @param {Node[]} nodes @returns {StubEl} */
function wrapNodes(nodes) {
  const root = new StubEl();
  root.append(.../** @type {StubEl[]} */ (/** @type {unknown} */ (nodes)));
  return root;
}

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
  return findAll(root, 'section').map((s) => {
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

test('HomePage: visitor only — renders single Visitor section, no other roles', () => {
  const root = wrapNodes(HomePage({ capabilities: caps({ isVisitor: true }) }));
  assert.deepEqual(sectionHeadings(root), ['Visitor']);
});

test('HomePage: visitor section has explainer text and no links', () => {
  const root = wrapNodes(HomePage({ capabilities: caps({ isVisitor: true }) }));

  // explainer paragraph present
  assert.ok(findAll(root, 'p').length >= 1, 'visitor explainer text present');
  // no anchors at all — access is managed out-of-band, no in-app affordance
  assert.equal(findAll(root, 'a').length, 0, 'no anchors in visitor section');
});

test('HomePage: reviewer — single section linking to dashboard', () => {
  const root = wrapNodes(
    HomePage({ capabilities: caps({ isReviewer: true }) })
  );

  assert.deepEqual(sectionHeadings(root), ['Reviewer']);
  assert.deepEqual(sectionLinks(root), ['#/dashboard']);
});

test('HomePage: reviewer manager — links to reviewer team report', () => {
  const root = wrapNodes(
    HomePage({ capabilities: caps({ isReviewerManager: true }) })
  );

  assert.deepEqual(sectionHeadings(root), ['Reviewer Manager']);
  assert.deepEqual(sectionLinks(root), ['#/reports/reviewer-team']);
});

test('HomePage: responsible party manager — links to responsible party team report', () => {
  const root = wrapNodes(
    HomePage({ capabilities: caps({ isResponsiblePartyManager: true }) })
  );

  assert.deepEqual(sectionHeadings(root), ['Responsible Party Manager']);
  assert.deepEqual(sectionLinks(root), ['#/reports/responsible-party-team']);
});

test('HomePage: responsible party — links to my cases', () => {
  const root = wrapNodes(HomePage({ capabilities: caps({ isAdviser: true }) }));

  assert.deepEqual(sectionHeadings(root), ['Responsible Party']);
  assert.deepEqual(sectionLinks(root), ['#/my-cases']);
});

test('HomePage: case type owner — links to question bank', () => {
  const root = wrapNodes(
    HomePage({ capabilities: caps({ ownedCaseTypes: ['example-review'] }) })
  );

  assert.deepEqual(sectionHeadings(root), ['Case Type Owner']);
  assert.deepEqual(sectionLinks(root), ['#/question-bank']);
});

test('HomePage: journey owner — links to journey cases', () => {
  const root = wrapNodes(
    HomePage({
      capabilities: caps({ ownedJourneyCaseTypes: ['complaints'] }),
    })
  );

  assert.deepEqual(sectionHeadings(root), ['Journey Owner']);
  assert.deepEqual(sectionLinks(root), ['#/journey-cases']);
});

test('HomePage: maintainer — links to question bank', () => {
  const root = wrapNodes(
    HomePage({ capabilities: caps({ isMaintainer: true }) })
  );

  assert.deepEqual(sectionHeadings(root), ['Maintainer']);
  assert.deepEqual(sectionLinks(root), ['#/question-bank']);
});

test('HomePage: multi-role — only matching sections, in documented order', () => {
  const root = wrapNodes(
    HomePage({
      capabilities: caps({
        isReviewer: true,
        isResponsiblePartyManager: true,
        ownedCaseTypes: ['example-review'],
        isMaintainer: true,
        listAccessCaseTypes: [],
        ownedJourneyCaseTypes: [],
      }),
    })
  );

  assert.deepEqual(sectionHeadings(root), [
    'Reviewer',
    'Responsible Party Manager',
    'Case Type Owner',
    'Maintainer',
  ]);
});

test('HomePage: full order — all roles render in documented order', () => {
  const root = wrapNodes(
    HomePage({
      capabilities: caps({
        isReviewer: true,
        isReviewerManager: true,
        isResponsiblePartyManager: true,
        isAdviser: true,
        ownedCaseTypes: ['example-review'],
        isMaintainer: true,
        listAccessCaseTypes: [],
        ownedJourneyCaseTypes: ['complaints'],
        isVisitor: true,
      }),
    })
  );

  assert.deepEqual(sectionHeadings(root), [
    'Reviewer',
    'Reviewer Manager',
    'Responsible Party Manager',
    'Responsible Party',
    'Case Type Owner',
    'Journey Owner',
    'Maintainer',
    'Visitor',
  ]);
});

test('HomePage: no capabilities set — renders nothing without throwing', () => {
  const root = wrapNodes(HomePage({ capabilities: null }));
  assert.deepEqual(sectionHeadings(root), []);
});
