// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { initRouter, routeRegistrationSpy } from './helpers/router.js';

isolateBrowserGlobals();

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
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({
      capabilities: { isReviewerManager: false },
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  assert.equal(registration.has('#/reports'), true);
  assert.equal(registration.has('#/reports/reviewer-team'), true);
});

test('reports route: #/reports unmount is a no-op (does not throw)', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({
      capabilities: { isReviewerManager: false },
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  assert.doesNotThrow(() => registration.handlerFor('#/reports').unmount());
});

test('reports route: #/reports/reviewer-team unmount is a no-op (does not throw)', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({
      capabilities: { isReviewerManager: false },
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );
  assert.doesNotThrow(() =>
    registration.handlerFor('#/reports/reviewer-team').unmount()
  );
});

test('reports route: #/reports renders ReportsIndexPage directly', async () => {
  makeDocSpy();
  const rendered = /** @type {any[]} */ ([]);

  const router = new Router();
  const container = {
    replaceChildren(/** @type {any[]} */ ...children) {
      rendered.splice(0, rendered.length, ...children);
    },
  };
  initRouter(router, /** @type {any} */ (container));
  register(
    router,
    /** @type {any} */ ({
      capabilities: { isReviewerManager: true, ownedCaseTypes: [] },
      client: {},
      currentUser: { id: 'u1' },
      caseSources: [].map((s) => src(s)),
    })
  );

  await router.navigate('#/reports');

  assert.equal(rendered.length, 1, 'reports index should render one card');
  assert.equal(rendered[0].tagName, 'DIV');
  // The router error panel is also a DIV; assert this is the real page.
  assert.notEqual(rendered[0].className, 'cora-route-error');
  assert.equal(
    rendered[0]._children[0].textContent,
    'Reviewer Team Performance'
  );
});

test('reports/reviewer-team route: redirects to #/reports when not a Reviewer Manager', async () => {
  makeDocSpy();
  try {
    const router = new Router();
    const container = { replaceChildren(/** @type {any[]} */ ...args) {} };
    initRouter(router, /** @type {any} */ (container));
    register(
      router,
      /** @type {any} */ ({
        capabilities: { isReviewerManager: false },
        client: {},
        currentUser: { id: 'u1' },
        caseSources: [].map((s) => src(s)),
      })
    );
    await router.navigate('#/reports/reviewer-team');
    assert.equal(
      /** @type {any} */ (globalThis).location.hash,
      '#/reports',
      'should redirect to #/reports'
    );
  } finally {
    /** @type {any} */ (globalThis).location = { hash: '' };
  }
});

test('reports route: #/reports renders a cora-route-error panel when the index page module fails to load', async () => {
  makeDocSpy();
  const origConsoleError = console.error;
  console.error = () => {};
  const rendered = /** @type {any[]} */ ([]);

  try {
    const router = new Router();
    const container = {
      replaceChildren(/** @type {any[]} */ ...children) {
        rendered.splice(0, rendered.length, ...children);
      },
    };
    initRouter(router, /** @type {any} */ (container));
    register(
      router,
      /** @type {any} */ ({
        capabilities: { isReviewerManager: true, ownedCaseTypes: [] },
        client: {},
        currentUser: { id: 'u1' },
        caseSources: [].map((s) => src(s)),
      }),
      { loadIndex: () => Promise.reject(new Error('boom')) }
    );

    await router.navigate('#/reports');

    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
  }
});

test('reports/reviewer-team route: mounts ReviewerTeamReportPage with client, currentUser, caseSources for Reviewer Manager', async () => {
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
    initRouter(router, /** @type {any} */ (container));
    register(
      router,
      /** @type {any} */ ({
        capabilities: { isReviewerManager: true },
        client,
        currentUser,
        caseSources,
      })
    );
    await router.navigate('#/reports/reviewer-team');

    assert.equal(
      rendered.length,
      1,
      'ReviewerTeamReportPage host should be mounted'
    );
    assert.equal(rendered[0].tagName, 'DIV');
    // The router error panel is also a DIV; assert this is the real page.
    assert.notEqual(rendered[0].className, 'cora-route-error');
  } finally {
    /** @type {any} */ (globalThis).location = { hash: '' };
  }
});

test('reports/reviewer-team route: renders a cora-route-error panel when the reviewer-team page module fails to load', async () => {
  makeDocSpy();
  const origConsoleError = console.error;
  console.error = () => {};
  try {
    const rendered = /** @type {any[]} */ ([]);

    const router = new Router();
    const container = {
      replaceChildren(/** @type {any[]} */ ...children) {
        rendered.splice(0, rendered.length, ...children);
      },
    };
    initRouter(router, /** @type {any} */ (container));
    register(
      router,
      /** @type {any} */ ({
        capabilities: { isReviewerManager: true },
        client: {},
        currentUser: { id: 'u1' },
        caseSources: [].map((s) => src(s)),
      }),
      { loadReviewerTeam: () => Promise.reject(new Error('boom')) }
    );
    await router.navigate('#/reports/reviewer-team');

    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
    /** @type {any} */ (globalThis).location = { hash: '' };
  }
});
