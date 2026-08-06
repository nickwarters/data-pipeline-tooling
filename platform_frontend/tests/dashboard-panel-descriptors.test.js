// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleDashboardPanels } from '../src/pages/dashboard/panel-descriptors.js';

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
    // Two panels are absent only because the Appeals feature switch is off.
    // 'appeals' because the Controls panel would be a permanently empty table;
    // 'actionCentre' because Appeals is the only reason a Controls capability
    // contributes, and this user holds no reviewer role — so their worklist has
    // no groups at all and the panel is dropped rather than shown empty.
    // Restore both when the switch goes:
    // ['kpis', 'actionCentre', 'ownerSummary', 'responsibleParty', 'appeals']
    ['kpis', 'ownerSummary', 'responsibleParty']
  );
  assert.deepEqual(visibleDashboardPanels(capabilities()), []);
});
