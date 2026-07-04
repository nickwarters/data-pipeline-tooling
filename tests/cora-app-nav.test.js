// @ts-check
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

/** @type {any} */ (globalThis).location = { hash: '#/dashboard' };

// ===== IMPORTS (after stubs) =====
const { CORAAppNav } =
  await import('../src/components/sections/cora-app-nav.js');

/**
 * Find a nav item (<a class="cora-app-nav-item">) with the given href.
 * @param {any} node
 * @param {string} href
 * @returns {any|null}
 */
function findNavItem(node, href) {
  if (
    node.tagName === 'A' &&
    node.className.includes('cora-app-nav-item') &&
    node.href === href
  )
    return node;
  for (const c of node._children ?? []) {
    const found = findNavItem(c, href);
    if (found) return found;
  }
  return null;
}

// ===== TESTS =====

test('cora-app-nav: reviewer sees dashboard link', () => {
  const el = new CORAAppNav();
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.connectedCallback();
  assert.ok(
    findNavItem(el, '#/dashboard'),
    'reviewer should see dashboard link'
  );
});

test('cora-app-nav: reviewer does not see reports link', () => {
  const el = new CORAAppNav();
  el.capabilities = {
    isReviewer: true,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.connectedCallback();
  assert.equal(
    findNavItem(el, '#/reports'),
    null,
    'reviewer without manager role should not see reports'
  );
});

test('cora-app-nav: reviewer manager sees dashboard and reports links', () => {
  const el = new CORAAppNav();
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: true,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.connectedCallback();
  assert.ok(
    findNavItem(el, '#/dashboard'),
    'reviewer manager should see dashboard link'
  );
  assert.ok(
    findNavItem(el, '#/reports'),
    'reviewer manager should see reports link'
  );
});

test('cora-app-nav: reviewer manager does not see question bank link', () => {
  const el = new CORAAppNav();
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: true,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.connectedCallback();
  assert.equal(
    findNavItem(el, '#/question-bank'),
    null,
    'reviewer manager should not see question bank'
  );
});

test('cora-app-nav: case type owner sees dashboard, reports, and question bank links', () => {
  const el = new CORAAppNav();
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: ['example-review'],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.connectedCallback();
  assert.ok(
    findNavItem(el, '#/dashboard'),
    'case type owner should see dashboard link'
  );
  assert.ok(
    findNavItem(el, '#/reports'),
    'case type owner should see reports link'
  );
  assert.ok(
    findNavItem(el, '#/question-bank'),
    'case type owner should see question bank link'
  );
});

test('cora-app-nav: responsible party sees dashboard link', () => {
  const el = new CORAAppNav();
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: true,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.connectedCallback();
  assert.ok(
    findNavItem(el, '#/dashboard'),
    'responsible party should see dashboard link'
  );
  assert.equal(
    findNavItem(el, '#/reports'),
    null,
    'responsible party should not see reports'
  );
  assert.equal(
    findNavItem(el, '#/question-bank'),
    null,
    'responsible party should not see question bank'
  );
});

test('cora-app-nav: visitor with no roles sees no nav links', () => {
  const el = new CORAAppNav();
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.connectedCallback();
  assert.equal(
    findNavItem(el, '#/dashboard'),
    null,
    'visitor should see no dashboard nav item'
  );
  assert.equal(
    findNavItem(el, '#/reports'),
    null,
    'visitor should see no reports nav item'
  );
  assert.equal(
    findNavItem(el, '#/question-bank'),
    null,
    'visitor should see no question bank nav item'
  );
});

test('cora-app-nav: active item matches current hash exactly', () => {
  /** @type {any} */ (globalThis).location = { hash: '#/dashboard' };
  const el = new CORAAppNav();
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: true,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.connectedCallback();
  const dash = findNavItem(el, '#/dashboard');
  assert.ok(dash, 'dashboard link should exist');
  assert.equal(
    dash.getAttribute('aria-current'),
    'page',
    'dashboard link should be active'
  );
  const reports = findNavItem(el, '#/reports');
  assert.ok(reports, 'reports link should exist');
  assert.equal(
    reports.getAttribute('aria-current'),
    '',
    'reports link should not be active'
  );
});

test('cora-app-nav: active item matches sub-route prefix', () => {
  /** @type {any} */ (globalThis).location = {
    hash: '#/reports/reviewer-team',
  };
  const el = new CORAAppNav();
  el.capabilities = {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: true,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
  el.connectedCallback();
  const reports = findNavItem(el, '#/reports');
  assert.ok(reports, 'reports link should exist');
  assert.equal(
    reports.getAttribute('aria-current'),
    'page',
    'reports link should be active on sub-route'
  );
  const dash = findNavItem(el, '#/dashboard');
  assert.equal(
    dash.getAttribute('aria-current'),
    '',
    'dashboard link should not be active'
  );
});
