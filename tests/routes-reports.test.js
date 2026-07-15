// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};
/** @type {any} */ (globalThis).location = { hash: '' };

/** @returns {{ created: string[] }} */
function makeDocSpy() {
  const created = /** @type {string[]} */ ([]);
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      const el = /** @type {any} */ ({
        tag,
        tagName: tag.toUpperCase(),
        textContent: '',
        className: '',
        href: '',
        _children: [],
        appendChild(/** @type {any} */ child) {
          this._children.push(child);
          return child;
        },
        setAttribute() {},
        replaceChildren() {},
      });
      created.push(tag);
      return el;
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };
  return { created };
}

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/reports.js';

/**
 * @param {string} slug
 * @param {string} [listName]
 * @returns {import('../src/setup/resolve-eligible-case-types.js').CaseSource}
 */
const src = (slug, listName = `${slug}-list`) => ({
  slug,
  listName,
  displayName: slug,
});

test('reports route: registers #/reports and #/reports/reviewer-team', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      capabilities: { isReviewerManager: false },
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/reports')),
    '#/reports should be registered'
  );
  assert.ok(
    router._routes.some((r) => r.re.test('#/reports/reviewer-team')),
    '#/reports/reviewer-team should be registered'
  );
});

test('reports route: #/reports unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      capabilities: { isReviewerManager: false },
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  const route = router._routes.find((r) => r.re.test('#/reports'));
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
});

test('reports route: #/reports/reviewer-team unmount is a no-op (does not throw)', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      capabilities: { isReviewerManager: false },
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  const route = router._routes.find((r) =>
    r.re.test('#/reports/reviewer-team')
  );
  assert.ok(route, 'route should exist');
  assert.doesNotThrow(() => route.handler.unmount());
});

test('reports route: #/reports renders ReportsIndexPage directly', () => {
  makeDocSpy();
  const rendered = /** @type {any[]} */ ([]);

  const router = new Router();
  const container = {
    replaceChildren(/** @type {any[]} */ ...children) {
      rendered.splice(0, rendered.length, ...children);
    },
  };
  router._container = /** @type {any} */ (container);
  register(
    router,
    /** @type {any} */ ({
      capabilities: { isReviewerManager: true, ownedCaseTypes: [] },
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );

  router.navigate('#/reports');

  assert.equal(rendered.length, 1, 'reports index should render one card');
  assert.equal(rendered[0].tagName, 'DIV');
  assert.equal(
    rendered[0]._children[0].textContent,
    'Reviewer Team Performance'
  );
});

test('reports/reviewer-team route: redirects to #/reports when not a Reviewer Manager', () => {
  makeDocSpy();
  try {
    const router = new Router();
    const container = { replaceChildren(/** @type {any[]} */ ...args) {} };
    router._container = /** @type {any} */ (container);
    register(
      router,
      /** @type {any} */ ({
        capabilities: { isReviewerManager: false },
        client: {},
        currentUser: { id: 'u1' },
        caseSources: [].map((s) => src(s)),
      })
    );
    router.navigate('#/reports/reviewer-team');
    assert.equal(
      /** @type {any} */ (globalThis).location.hash,
      '#/reports',
      'should redirect to #/reports'
    );
  } finally {
    /** @type {any} */ (globalThis).location = { hash: '' };
  }
});

test('reports/reviewer-team route: mounts ReviewerTeamReportPage with client, currentUser, eligibleCaseTypes for Reviewer Manager', () => {
  makeDocSpy();
  try {
    const client = {
      id: 'mock-client',
      async listCases() {
        return [];
      },
    };
    const currentUser = { id: 'user-rm', displayName: 'Morgan Manager' };
    const caseSources = [src('example-review')];
    const rendered = /** @type {any[]} */ ([]);

    const router = new Router();
    const container = {
      replaceChildren(/** @type {any[]} */ ...children) {
        rendered.splice(0, rendered.length, ...children);
      },
    };
    router._container = /** @type {any} */ (container);
    register(
      router,
      /** @type {any} */ ({
        capabilities: { isReviewerManager: true },
        client,
        currentUser,
        caseSources,
      })
    );
    router.navigate('#/reports/reviewer-team');

    assert.equal(
      rendered.length,
      1,
      'ReviewerTeamReportPage host should be mounted'
    );
    assert.equal(rendered[0].tagName, 'DIV');
  } finally {
    /** @type {any} */ (globalThis).location = { hash: '' };
  }
});
