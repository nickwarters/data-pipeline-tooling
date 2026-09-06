// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makePermissions } from './helpers/fixtures.js';
import { APP_CONFIG } from '../src/app-config.js';

installDom();
const { AppNav, updateActiveNavItems } =
  await import('../src/components/sections/cora-app-nav.js');
const { navItemsFor, resolveDefaultLandingPath } =
  await import('../src/setup/register-routes.js');

/**
 * The bar as this user actually gets it: resolved from the composition, then
 * drawn. `AppNav` itself reads no capability now, so a test that asks "does a
 * Reviewer Manager see My Team?" has to go through the resolution to mean
 * anything.
 *
 * @param {any} caps @param {string} hash
 */
function renderNav(caps, hash) {
  return AppNav({
    items: navItemsFor(caps),
    brandHref: resolveDefaultLandingPath(caps),
    hash,
  });
}

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
    const { node } = renderNav(
      /** @type {any} */ (capabilities({ [role]: true })),
      '#/'
    );
    assert.ok(findLink(node, '#/dashboard'), role);
  }
});

test('AppNav: Case Type Owner sees Question Bank; other roles do not', () => {
  const owner = renderNav(
    /** @type {any} */ (capabilities({ ownedCaseTypes: ['complaints'] })),
    '#/'
  ).node;
  assert.ok(findLink(owner, '#/question-bank'));

  const reviewer = renderNav(
    /** @type {any} */ (capabilities({ isReviewer: true })),
    '#/'
  ).node;
  assert.equal(findLink(reviewer, '#/question-bank'), null);
});

test('AppNav: only Reviewer Managers see My Team', () => {
  const manager = renderNav(
    /** @type {any} */ (capabilities({ isReviewerManager: true })),
    '#/my-team'
  ).node;
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
    const node = renderNav(/** @type {any} */ (capabilities(role)), '#/').node;
    assert.equal(findLink(node, '#/my-team'), null);
  }
});

test('AppNav: My Stats is visible to Reviewers, including dual-role users', () => {
  const reviewer = renderNav(
    /** @type {any} */ (capabilities({ isReviewer: true })),
    '#/'
  ).node;
  assert.ok(findLink(reviewer, '#/my-stats'));

  const manager = renderNav(
    /** @type {any} */ (capabilities({ isReviewerManager: true })),
    '#/'
  ).node;
  assert.equal(findLink(manager, '#/my-stats'), null);

  const both = renderNav(
    /** @type {any} */ (
      capabilities({ isReviewer: true, isReviewerManager: true })
    ),
    '#/my-stats'
  ).node;
  assert.equal(
    findLink(both, '#/my-stats')?.getAttribute('aria-current'),
    'page'
  );
});

test('AppNav: only Reviewer Managers see Team Stats, and it is active on that route', () => {
  const manager = renderNav(
    /** @type {any} */ (capabilities({ isReviewerManager: true })),
    '#/team-stats'
  ).node;
  assert.ok(findLink(manager, '#/team-stats'));
  assert.equal(
    findLink(manager, '#/team-stats')?.getAttribute('aria-current'),
    'page'
  );

  const reviewer = renderNav(
    /** @type {any} */ (capabilities({ isReviewer: true })),
    '#/team-stats'
  ).node;
  assert.equal(findLink(reviewer, '#/team-stats'), null);
});

test('AppNav: dual-role manager order keeps My Stats, Team Stats, Question Bank, then My Team', () => {
  const { node } = renderNav(
    /** @type {any} */ (
      capabilities({
        isReviewer: true,
        isReviewerManager: true,
        ownedCaseTypes: ['complaints'],
      })
    ),
    '#/'
  );

  const links = Array.from(
    node.querySelectorAll('a'),
    (link) => link.href
  ).filter((href) =>
    ['#/my-stats', '#/team-stats', '#/question-bank', '#/my-team'].includes(
      href
    )
  );

  assert.deepEqual(links, [
    '#/my-stats',
    '#/team-stats',
    '#/question-bank',
    '#/my-team',
  ]);
});

test('AppNav: only Controls see Search, and Controls reach the rest of the app', () => {
  const controls = renderNav(
    /** @type {any} */ (
      capabilities({ isControls: true, canSearchCases: true })
    ),
    '#/search'
  ).node;
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
    const node = renderNav(/** @type {any} */ (capabilities(role)), '#/').node;
    assert.equal(findLink(node, '#/search'), null);
  }
});

test('updateActiveNavItems: Search stays active while its filters are in the hash', () => {
  const { navItems } = renderNav(
    /** @type {any} */ (
      capabilities({ isControls: true, canSearchCases: true })
    ),
    '#/search'
  );
  const search = navItems.find((item) => item.href === '#/search')?.el;
  assert.ok(search);
  assert.equal(search.getAttribute('aria-current'), 'page');

  updateActiveNavItems(navItems, '#/search?titlePrefix=CR-1');
  assert.equal(search.getAttribute('aria-current'), 'page');
});

test('AppNav: Visitor sees no navigation links, and the brand goes where they land', () => {
  const { node, navItems } = renderNav(
    /** @type {any} */ (capabilities()),
    '#/'
  );
  assert.equal(navItems.length, 0);
  // Not `#/dashboard`: a viewer no landing rule recognises is not sent to a
  // dashboard they cannot use. `#/` is the page written for them.
  assert.ok(findLink(node, '#/'), "the brand links to this viewer's landing");
  assert.equal(findLink(node, '#/dashboard'), null);
});

test('updateActiveNavItems: exact and sub-route hashes mark only the active item', () => {
  const { navItems } = renderNav(
    /** @type {any} */ (capabilities({ ownedCaseTypes: ['complaints'] })),
    '#/dashboard'
  );
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

// --- The bar comes from the composition, not from a chain of ifs ---

/**
 * Today's bar, per persona, as a list of hrefs in the order they are drawn.
 * Written down rather than derived, because the order used to be implied by the
 * order of a chain of `if`s and `nav.order` numbers chosen by eye would move it.
 *
 * @type {[string, Partial<Capabilities>, string[]][]}
 */
const PERSONAS = [
  ['visitor', {}, []],
  [
    'reviewer',
    { isReviewer: true },
    ['#/dashboard', '#/roadmap', '#/my-stats'],
  ],
  ['adviser', { isAdviser: true }, ['#/dashboard', '#/roadmap']],
  ['controls', { isControls: true }, ['#/dashboard', '#/roadmap']],
  [
    'controls who may search',
    { isControls: true, canSearchCases: true },
    ['#/dashboard', '#/roadmap', '#/search'],
  ],
  [
    'reviewer manager',
    { isReviewerManager: true },
    ['#/dashboard', '#/roadmap', '#/team-stats', '#/my-team'],
  ],
  [
    'case type owner',
    { ownedCaseTypes: ['complaints'] },
    ['#/dashboard', '#/roadmap', '#/question-bank'],
  ],
  [
    'reviewer who also manages and owns',
    {
      isReviewer: true,
      isReviewerManager: true,
      ownedCaseTypes: ['complaints'],
      canSearchCases: true,
    },
    [
      '#/dashboard',
      '#/roadmap',
      '#/my-stats',
      '#/team-stats',
      '#/question-bank',
      '#/my-team',
      '#/search',
    ],
  ],
];

for (const [persona, overrides, expected] of PERSONAS) {
  test(`AppNav: ${persona} gets the same links, in the same order`, () => {
    const { navItems } = renderNav(
      /** @type {any} */ (capabilities(overrides)),
      '#/'
    );
    assert.deepEqual(
      navItems.map((item) => item.href),
      expected
    );
  });
}

test('AppNav: a nav predicate that throws is not silently a missing link', () => {
  // Deliberate: the nav's failure is fatal and visible, because a link that
  // vanished would be indistinguishable from "you do not have permission".
  const config = /** @type {any} */ (APP_CONFIG);
  const original = config.pagePlugins;
  config.pagePlugins = [
    {
      id: 'broken',
      paths: ['#/broken'],
      page: {},
      nav: {
        label: 'Broken',
        order: 1,
        isVisible: () => {
          throw new Error('boom');
        },
      },
    },
  ];
  try {
    assert.throws(
      () => navItemsFor(/** @type {any} */ (capabilities())),
      /boom/
    );
  } finally {
    config.pagePlugins = original;
  }
});
