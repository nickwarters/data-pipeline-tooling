// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { makeChrome, makePermissions } from './helpers/fixtures.js';

installDom();

const { createRouteSlice, homeView } = await import('../src/pages/home.js');

/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */

// Home renders one panel per capability, so the baseline here is a user with
// none of them — the opposite of the shared factory's Reviewer posture.
/** @param {Partial<Capabilities>} overrides */
function capabilities(overrides = {}) {
  return makePermissions({ isReviewer: false, ...overrides });
}

/** @param {Partial<Capabilities>} permissionOverrides */
function state(permissionOverrides = {}) {
  return {
    chrome: makeChrome({
      currentUser: { id: 'u1', displayName: 'A User' },
      permissions: capabilities(permissionOverrides),
    }),
    routes: { home: {} },
  };
}

/** @param {HTMLElement} view */
function headings(view) {
  return [...view.querySelectorAll('h2')].map((heading) => heading.textContent);
}

/** @param {HTMLElement} view */
function links(view) {
  return [...view.querySelectorAll('a')].map((link) =>
    link.getAttribute('href')
  );
}

test('home view: visitor sees the explainer without an access-request link', () => {
  const view = homeView(state({ isVisitor: true }));

  assert.deepEqual(headings(view), ['Visitor']);
  assert.match(view.textContent, /Access is managed by your team/);
  assert.deepEqual(links(view), []);
});

test('home view: each role keeps its existing destination and order', () => {
  const view = homeView(
    state({
      isReviewer: true,
      isReviewerManager: true,
      isResponsiblePartyManager: true,
      isAdviser: true,
      ownedCaseTypes: ['complaints'],
      ownedJourneyCaseTypes: ['complaints'],
      isMaintainer: true,
      isVisitor: true,
    })
  );

  assert.deepEqual(headings(view), [
    'Reviewer',
    'Responsible Party',
    'Case Type Owner',
    'Journey Owner',
    'Maintainer',
    'Visitor',
  ]);
  assert.deepEqual(links(view), [
    '#/dashboard',
    '#/my-cases',
    '#/question-bank',
    '#/journey-cases',
    '#/question-bank',
  ]);
});

test('home view: no capabilities render an empty page tree', () => {
  const view = homeView(state());

  assert.equal(view.className, 'cora-home');
  assert.equal(view.childNodes.length, 0);
});

test('home slice: stores shared chrome without speculative route state', () => {
  const chrome = state({ ownedCaseTypes: ['complaints'] }).chrome;
  const slice = createRouteSlice({}, /** @type {any} */ ({ chrome }));

  assert.equal(slice.initialState.chrome, chrome);
  assert.deepEqual(slice.initialState.routes.home, {});
  assert.equal(
    slice.reducer(slice.initialState, { type: 'ignored' }),
    slice.initialState
  );
  assert.deepEqual(headings(slice.view(slice.initialState)), [
    'Case Type Owner',
  ]);
});
