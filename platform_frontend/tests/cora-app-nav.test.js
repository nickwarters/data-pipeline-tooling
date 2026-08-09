// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makePermissions } from './helpers/fixtures.js';

installDom();
const { AppNav, updateActiveNavItems } =
  await import('../src/components/sections/cora-app-nav.js');

/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */

// Each test grants exactly the one capability whose nav link it is about, so
// the baseline is a user with none — not the factory's Reviewer posture.
/** @param {Partial<Capabilities>} [overrides] */
function capabilities(overrides = {}) {
  return makePermissions({ isReviewer: false, ...overrides });
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

test('AppNav: only Reviewer Managers see My Team', () => {
  const manager = AppNav({
    capabilities: /** @type {any} */ (
      capabilities({ isReviewerManager: true })
    ),
    hash: '#/my-team',
  }).node;
  assert.ok(findLink(manager, '#/my-team'));
  assert.equal(
    findLink(manager, '#/my-team')?.getAttribute('aria-current'),
    'page'
  );

  for (const role of [
    { isReviewer: true },
    { isAdviser: true },
    { ownedCaseTypes: ['complaints'] },
    {},
  ]) {
    const node = AppNav({
      capabilities: /** @type {any} */ (capabilities(role)),
      hash: '#/',
    }).node;
    assert.equal(findLink(node, '#/my-team'), null);
  }
});

test('AppNav: My Stats is visible to Reviewers, including dual-role users', () => {
  const reviewer = AppNav({
    capabilities: /** @type {any} */ (capabilities({ isReviewer: true })),
    hash: '#/',
  }).node;
  assert.ok(findLink(reviewer, '#/my-stats'));

  const manager = AppNav({
    capabilities: /** @type {any} */ (
      capabilities({ isReviewerManager: true })
    ),
    hash: '#/',
  }).node;
  assert.equal(findLink(manager, '#/my-stats'), null);

  const both = AppNav({
    capabilities: /** @type {any} */ (
      capabilities({ isReviewer: true, isReviewerManager: true })
    ),
    hash: '#/my-stats',
  }).node;
  assert.equal(
    findLink(both, '#/my-stats')?.getAttribute('aria-current'),
    'page'
  );
});

test('AppNav: only Controls see Search, and Controls reach the rest of the app', () => {
  const controls = AppNav({
    capabilities: /** @type {any} */ (
      capabilities({ isControls: true, canSearchCases: true })
    ),
    hash: '#/search',
  }).node;
  assert.ok(findLink(controls, '#/search'));
  // Controls held no nav link at all before search existed, which would have
  // left the one role the feature is for with no way to reach it.
  assert.ok(findLink(controls, '#/dashboard'), 'Controls keep the Dashboard');

  for (const role of [
    { isReviewer: true },
    { isAdviser: true },
    { isReviewerManager: true },
    { ownedCaseTypes: ['complaints'] },
  ]) {
    const node = AppNav({
      capabilities: /** @type {any} */ (capabilities(role)),
      hash: '#/',
    }).node;
    assert.equal(findLink(node, '#/search'), null);
  }
});

test('updateActiveNavItems: Search stays active while its filters are in the hash', () => {
  const { navItems } = AppNav({
    capabilities: /** @type {any} */ (
      capabilities({ isControls: true, canSearchCases: true })
    ),
    hash: '#/search',
  });
  const search = navItems.find((item) => item.href === '#/search')?.el;
  assert.ok(search);
  assert.equal(search.getAttribute('aria-current'), 'page');

  updateActiveNavItems(navItems, '#/search?titlePrefix=CR-1');
  assert.equal(search.getAttribute('aria-current'), 'page');
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
  const roadmap = navItems.find((item) => item.href === '#/roadmap')?.el;
  assert.ok(roadmap);
  assert.equal(dashboard.getAttribute('aria-current'), 'page');
  assert.equal(bank.getAttribute('aria-current'), '');
  assert.equal(roadmap.getAttribute('aria-current'), '');

  updateActiveNavItems(navItems, '#/question-bank/editor');
  assert.equal(dashboard.getAttribute('aria-current'), '');
  assert.equal(bank.getAttribute('aria-current'), 'page');
  assert.equal(roadmap.getAttribute('aria-current'), '');

  updateActiveNavItems(navItems, '#/roadmap');
  assert.equal(dashboard.getAttribute('aria-current'), '');
  assert.equal(bank.getAttribute('aria-current'), '');
  assert.equal(roadmap.getAttribute('aria-current'), 'page');
});
