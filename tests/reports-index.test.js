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

test('reports index view: Reviewer Manager sees the team performance report link', () => {
  const view = reportsIndexView({ isReviewerManager: true });

  assert.equal(view.textContent, 'Reviewer Team PerformanceView report');
  assert.equal(
    view.querySelector('a')?.getAttribute('href'),
    '#/reports/reviewer-team'
  );
});

test('reports index view: user without report access sees the empty state', () => {
  const view = reportsIndexView({ isReviewerManager: false });

  assert.equal(view.tagName, 'P');
  assert.equal(view.textContent, "You don't have access to any reports");
  assert.equal(view.querySelector('a'), null);
});

test('reports index slice: derives route state from resolved capabilities', () => {
  const managerSlice = createRouteSlice(
    {},
    /** @type {any} */ ({ capabilities: capabilities(true) })
  );
  const nonManagerSlice = createRouteSlice(
    {},
    /** @type {any} */ ({ capabilities: capabilities(false) })
  );

  assert.deepEqual(managerSlice.initialState, { isReviewerManager: true });
  assert.deepEqual(nonManagerSlice.initialState, { isReviewerManager: false });
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
