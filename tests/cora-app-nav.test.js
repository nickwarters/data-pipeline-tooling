// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();
const { AppNav, updateActiveNavItems } =
  await import('../src/components/sections/cora-app-nav.js');

/** @param {Record<string, any>} [overrides] */
function capabilities(overrides = {}) {
  return {
    isReviewer: false,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
    ...overrides,
  };
}

/** @param {any} node @param {string} href @returns {any|null} */
function findLink(node, href) {
  return (
    node
      .querySelectorAll('a')
      .find((/** @type {any} */ link) => link.href === href) ?? null
  );
}

test('AppNav: reviewer, adviser, and manager capabilities expose Dashboard', () => {
  for (const role of ['isReviewer', 'isAdviser', 'isReviewerManager']) {
    const { node } = AppNav({
      capabilities: /** @type {any} */ (capabilities({ [role]: true })),
      hash: '#/',
    });
    assert.ok(findLink(node, '#/dashboard'), role);
  }
});

test('AppNav: Case Type Owner sees Question Bank; other roles do not', () => {
  const owner = AppNav({
    capabilities: /** @type {any} */ (
      capabilities({ ownedCaseTypes: ['complaints'] })
    ),
    hash: '#/',
  }).node;
  assert.ok(findLink(owner, '#/question-bank'));

  const reviewer = AppNav({
    capabilities: /** @type {any} */ (capabilities({ isReviewer: true })),
    hash: '#/',
  }).node;
  assert.equal(findLink(reviewer, '#/question-bank'), null);
});

test('AppNav: Visitor sees no navigation links beyond the CORA brand', () => {
  const { node, navItems } = AppNav({
    capabilities: /** @type {any} */ (capabilities()),
    hash: '#/',
  });
  assert.equal(navItems.length, 0);
  assert.ok(findLink(node, '#/dashboard'), 'brand remains a home link');
});

test('updateActiveNavItems: exact and sub-route hashes mark only the active item', () => {
  const { navItems } = AppNav({
    capabilities: /** @type {any} */ (
      capabilities({ ownedCaseTypes: ['complaints'] })
    ),
    hash: '#/dashboard',
  });
  const dashboard = navItems.find((item) => item.href === '#/dashboard')?.el;
  const bank = navItems.find((item) => item.href === '#/question-bank')?.el;
  assert.ok(dashboard);
  assert.ok(bank);
  assert.equal(dashboard.getAttribute('aria-current'), 'page');
  assert.equal(bank.getAttribute('aria-current'), '');

  updateActiveNavItems(navItems, '#/question-bank/editor');
  assert.equal(dashboard.getAttribute('aria-current'), '');
  assert.equal(bank.getAttribute('aria-current'), 'page');
});
