// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';

installDom();

const { kpiStripView } = await import('../src/pages/dashboard/kpi-view.js');

function lane(overrides = {}) {
  return /** @type {import('../src/evaluators/kpi-strip-model.js').KpiLane} */ ({
    role: 'reviewer',
    label: 'As Reviewer',
    scopeLabel: 'Complaints',
    isPrimary: true,
    defaultOpen: true,
    totalItems: 2,
    tiles: [
      {
        key: 'overdue',
        label: 'Overdue',
        tone: 'overdue',
        count: 2,
        defaultExpanded: false,
        breakdown: {
          axis: 'caseType',
          rows: [{ label: 'Complaints', count: 2 }],
        },
      },
    ],
    ...overrides,
  });
}

test('KPI pure view renders evaluator output and dispatches disclosure callbacks', () => {
  /** @type {string[]} */
  const actions = [];
  const strip = kpiStripView({
    lanes: [lane()],
    openLanes: new Set(['reviewer']),
    expandedTiles: new Set(['reviewer:overdue']),
    onToggleLane: (role) => actions.push(`lane:${role}`),
    onToggleTile: (role, key) => actions.push(`tile:${role}:${key}`),
  });
  assert.ok(strip);
  assert.equal(strip.getAttribute('aria-label'), 'Role worklist summary');
  assert.equal(
    findByClass(strip, 'cora-kpi-lane__role')?.textContent,
    'As Reviewer'
  );
  assert.equal(findByClass(strip, 'cora-kpi-row__count')?.textContent, '2');

  const header = findByClass(strip, 'cora-kpi-lane__header');
  const tile = findByClass(strip, 'cora-kpi-tile cora-kpi-tile--overdue');
  header?._fire('click', {});
  tile?._fire('click', {});
  header?._fire('click', {});
  tile?._fire('click', {});
  header?._fire('click', {});
  tile?._fire('click', {});
  assert.deepEqual(actions, [
    'lane:reviewer',
    'tile:reviewer:overdue',
    'lane:reviewer',
    'tile:reviewer:overdue',
    'lane:reviewer',
    'tile:reviewer:overdue',
  ]);
});

test('KPI pure view folds lanes and omits the strip when the model has no lanes', () => {
  const folded = kpiStripView({
    lanes: [lane({ isPrimary: false })],
    openLanes: new Set(),
    expandedTiles: new Set(),
    onToggleLane: () => {},
    onToggleTile: () => {},
  });
  assert.match(folded?.textContent ?? '', /Complaints — 2 items/);
  assert.equal(findByClass(folded, 'cora-kpi-tiles'), null);
  assert.equal(
    kpiStripView({
      lanes: [],
      openLanes: new Set(),
      expandedTiles: new Set(),
      onToggleLane: () => {},
      onToggleTile: () => {},
    }),
    null
  );
});

test('KPI pure view renders reason breakdowns without case-type bars', () => {
  const owner = lane({
    role: 'owner',
    tiles: [
      {
        key: 'at-risk',
        label: 'At risk',
        tone: 'at-risk',
        count: 1,
        defaultExpanded: true,
        breakdown: {
          axis: 'reason',
          rows: [{ label: 'Overdue on team', count: 1 }],
        },
      },
    ],
  });
  const strip = kpiStripView({
    lanes: [owner],
    openLanes: new Set(['owner']),
    expandedTiles: new Set(['owner:at-risk']),
    onToggleLane: () => {},
    onToggleTile: () => {},
  });
  assert.equal(findByClass(strip, 'cora-kpi-row__bar'), null);
  assert.match(strip?.textContent ?? '', /Overdue on team/);
});

test('KPI pure view renders a non-disclosable tile as static content', () => {
  const strip = kpiStripView({
    lanes: [
      lane({
        tiles: [
          {
            key: 'assigned',
            label: 'Assigned',
            tone: 'neutral',
            count: 3,
            defaultExpanded: false,
            breakdown: null,
          },
        ],
      }),
    ],
    openLanes: new Set(['reviewer']),
    expandedTiles: new Set(),
    onToggleLane: () => {},
    onToggleTile: () => {},
  });
  const tile = findByClass(strip, 'cora-kpi-tile cora-kpi-tile--neutral');
  assert.equal(tile?.tagName, 'DIV');
  assert.equal(tile?.querySelector('.cora-kpi-tile__caret'), null);
  assert.match(tile?.textContent ?? '', /3Assigned/);
});
