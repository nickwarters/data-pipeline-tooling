// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { createRouteSlice, reportsIndexView } =
  await import('../src/pages/reports-index.js');

/** @param {boolean} isReviewerManager @returns {import('../src/services/permissions.js').Capabilities} */
function capabilities(isReviewerManager) {
  return {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
}

/** @param {boolean} isReviewerManager */
function state(isReviewerManager) {
  return {
    chrome: {
      toasts: [],
      nav: { currentHash: '#/reports' },
      currentUser: { id: 'u1', displayName: 'A User' },
      permissions: capabilities(isReviewerManager),
    },
    routes: { reports: {} },
  };
}

test('reports index view: Reviewer Manager sees the team performance report link', () => {
  const view = reportsIndexView(state(true));

  assert.equal(view.textContent, 'Reviewer Team PerformanceView report');
  assert.equal(
    view.querySelector('a')?.getAttribute('href'),
    '#/reports/reviewer-team'
  );
});

test('reports index view: user without report access sees the empty state', () => {
  const view = reportsIndexView(state(false));

  assert.equal(view.tagName, 'P');
  assert.equal(view.textContent, "You don't have access to any reports");
  assert.equal(view.querySelector('a'), null);
});

test('reports index slice: derives route state from resolved capabilities', () => {
  const managerChrome = state(true).chrome;
  const nonManagerChrome = state(false).chrome;
  const managerSlice = createRouteSlice(
    {},
    /** @type {any} */ ({ chrome: managerChrome })
  );
  const nonManagerSlice = createRouteSlice(
    {},
    /** @type {any} */ ({ chrome: nonManagerChrome })
  );

  assert.equal(managerSlice.initialState.chrome, managerChrome);
  assert.equal(nonManagerSlice.initialState.chrome, nonManagerChrome);
  assert.deepEqual(managerSlice.initialState.routes, { reports: {} });
  assert.equal(
    managerSlice.reducer(managerSlice.initialState, { type: 'ignored' }),
    managerSlice.initialState,
    'the read-only route has no state transition actions'
  );
  assert.equal(
    managerSlice.view(managerSlice.initialState).textContent,
    'Reviewer Team PerformanceView report'
  );
});
