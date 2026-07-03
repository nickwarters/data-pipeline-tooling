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

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/reports.js';

/** @returns {{ created: string[], replaced: unknown[], elements: any[] }} */
function makeDocSpy() {
  const created = /** @type {string[]} */ ([]);
  const replaced = /** @type {unknown[]} */ ([]);
  const elements = /** @type {any[]} */ ([]);
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
      elements.push(el);
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
  return { created, replaced, elements };
}

test('reports route: registers #/reports and #/reports/reviewer-team', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  register(
    router,
    /** @type {any} */ ({
      capabilities: { isReviewerManager: false },
      client: {},
      currentUser: { id: 'u1' },
      eligibleCaseTypes: [],
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
      eligibleCaseTypes: [],
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
  const { created } = makeDocSpy();
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
        eligibleCaseTypes: [],
      })
    );
    router.navigate('#/reports/reviewer-team');
    assert.ok(
      !created.includes('cr-reviewer-team-report'),
      'should not create report element'
    );
    assert.equal(
      /** @type {any} */ (globalThis).location.hash,
      '#/reports',
      'should redirect to #/reports'
    );
  } finally {
    /** @type {any} */ (globalThis).location = { hash: '' };
  }
});

test('reports/reviewer-team route: mounts page with client, currentUser, eligibleCaseTypes for Reviewer Manager', () => {
  const { elements } = makeDocSpy();
  try {
    const client = { id: 'mock-client' };
    const currentUser = { id: 'user-rm', displayName: 'Morgan Manager' };
    const eligibleCaseTypes = ['example-review'];

    const router = new Router();
    const container = { replaceChildren(/** @type {any[]} */ ...args) {} };
    router._container = /** @type {any} */ (container);
    register(
      router,
      /** @type {any} */ ({
        capabilities: { isReviewerManager: true },
        client,
        currentUser,
        eligibleCaseTypes,
      })
    );
    router.navigate('#/reports/reviewer-team');

    const reportEl = elements.find((e) => e.tag === 'cr-reviewer-team-report');
    assert.ok(reportEl, 'cr-reviewer-team-report element should be created');
    assert.equal(reportEl.client, client, 'should set client');
    assert.equal(reportEl.currentUser, currentUser, 'should set currentUser');
    assert.deepEqual(
      reportEl.eligibleCaseTypes,
      eligibleCaseTypes,
      'should set eligibleCaseTypes'
    );
  } finally {
    /** @type {any} */ (globalThis).location = { hash: '' };
  }
});
