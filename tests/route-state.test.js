// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { patchRoute, patchSnapshot } =
  await import('../src/core/route-state.js');

function stateWith(/** @type {any} */ routes, /** @type {any} */ chrome = {}) {
  return { chrome, routes };
}

test('patchRoute: writes only the patched fields of the named route', () => {
  const state = stateWith({ dashboard: { cases: [], sort: null } });
  const next = patchRoute(state, 'dashboard', { cases: [1, 2] });

  assert.deepEqual(next.routes.dashboard, { cases: [1, 2], sort: null });
});

test('patchRoute: preserves sibling fields of the patched route', () => {
  const state = stateWith({
    caseReview: { activeTab: 'summary', saveStatus: 'saved', snapshot: null },
  });
  const next = patchRoute(state, 'caseReview', { saveStatus: 'saving' });

  assert.equal(next.routes.caseReview.activeTab, 'summary');
  assert.equal(next.routes.caseReview.snapshot, null);
  assert.equal(next.routes.caseReview.saveStatus, 'saving');
});

test('patchRoute: preserves chrome by reference', () => {
  const chrome = { toasts: [], nav: { currentHash: '#/' } };
  const state = stateWith({ home: {} }, chrome);
  const next = patchRoute(state, 'home', { greeting: 'hi' });

  assert.equal(next.chrome, chrome);
});

test('patchRoute: preserves sibling routes, not just the patched one', () => {
  const sibling = { cases: null };
  const state = stateWith({ dashboard: { cases: [] }, teamCases: sibling });
  const next = patchRoute(state, 'dashboard', { cases: [1] });

  assert.equal(next.routes.teamCases, sibling);
});

test('patchRoute: preserves state fields outside chrome and routes', () => {
  const state = { chrome: {}, routes: { home: {} }, params: { id: '7' } };
  const next = /** @type {any} */ (patchRoute(state, 'home', { seen: true }));

  assert.deepEqual(next.params, { id: '7' });
});

test('patchRoute: returns new state, route and routes objects', () => {
  const state = stateWith({ dashboard: { cases: [] } });
  const next = patchRoute(state, 'dashboard', { cases: [1] });

  assert.notEqual(next, state);
  assert.notEqual(next.routes, state.routes);
  assert.notEqual(next.routes.dashboard, state.routes.dashboard);
  assert.deepEqual(state.routes.dashboard, { cases: [] });
});

test('patchSnapshot: patches the Case Review snapshot in place', () => {
  const state = stateWith({
    caseReview: {
      activeTab: 'summary',
      snapshot: { caseRow: null, answers: {}, allAnswered: false },
    },
  });
  const next = patchSnapshot(state, { allAnswered: true });

  assert.equal(next.routes.caseReview.snapshot.allAnswered, true);
  assert.deepEqual(next.routes.caseReview.snapshot.answers, {});
  assert.equal(next.routes.caseReview.activeTab, 'summary');
});

test('patchSnapshot: returns the same state when no snapshot is loaded', () => {
  const state = stateWith({ caseReview: { snapshot: null } });

  assert.equal(patchSnapshot(state, { allAnswered: true }), state);
});

test('patchSnapshot: preserves chrome by reference', () => {
  const chrome = { toasts: [] };
  const state = stateWith(
    { caseReview: { snapshot: { caseRow: null } } },
    chrome
  );

  assert.equal(patchSnapshot(state, { caseRow: { id: 1 } }).chrome, chrome);
});
