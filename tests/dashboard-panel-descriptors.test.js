// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDashboardPanels,
  visibleDashboardPanels,
} from '../src/pages/dashboard/panel-descriptors.js';

function capabilities(overrides = {}) {
  return /** @type {any} */ ({
    isReviewer: false,
    isAdviser: false,
    isControls: false,
    ownedCaseTypes: [],
    ...overrides,
  });
}

test('dashboard panel descriptors express the role-visible panel set', () => {
  assert.deepEqual(visibleDashboardPanels(capabilities({ isReviewer: true })), [
    'kpis',
    'actionCentre',
    'reviewerCases',
    'allocation',
  ]);
  assert.deepEqual(
    visibleDashboardPanels(
      capabilities({
        isAdviser: true,
        isControls: true,
        ownedCaseTypes: ['complaints'],
      })
    ),
    ['kpis', 'actionCentre', 'ownerSummary', 'responsibleParty', 'appeals']
  );
  assert.deepEqual(visibleDashboardPanels(capabilities()), []);
});

test('dashboard panel descriptors intersect role visibility with Case Type presence', () => {
  assert.deepEqual(
    visibleDashboardPanels(capabilities({ isReviewer: true }), [
      'reviewerCases',
    ]),
    ['reviewerCases']
  );
});

test('dashboard panel descriptors resolve the canonical union declared by eligible Case Types', async () => {
  const panels = await resolveDashboardPanels(
    [{ slug: 'complaints' }, { slug: 'conduct' }],
    async (slug) =>
      /** @type {any} */ ({
        dashboardPanels:
          slug === 'complaints'
            ? ['reviewerCases', 'kpis']
            : ['responsibleParty', 'reviewerCases'],
      })
  );

  assert.deepEqual(panels, ['kpis', 'reviewerCases', 'responsibleParty']);
});
