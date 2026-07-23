// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole } from './helpers/semantic-dom.js';

installDom();

const {
  ROADMAP_DESCRIPTION_LIMIT,
  bucketRoadmapItems,
  createRouteSlice,
  roadmapReducer,
  roadmapView,
} = await import('../src/pages/roadmap.js');

/** @typedef {import('../src/sharepoint-client.js').RoadmapItem} RoadmapItem */

/** @type {RoadmapItem[]} */
const items = [
  {
    id: 'live-1',
    title: 'Live item',
    description: 'Already delivered.',
    theme: 'Core',
    labels: ['2026'],
    status: 'LIVE',
  },
  {
    id: 'doing-1',
    title: 'Doing item',
    description: 'Being delivered.',
    theme: 'Workflow',
    labels: [],
    status: 'IN PROGRESS',
  },
  {
    id: 'next-1',
    title: 'Future item',
    description: 'x'.repeat(ROADMAP_DESCRIPTION_LIMIT + 20),
    theme: 'Insight',
    labels: ['2027', 'P1'],
    status: 'UPCOMING',
  },
];

/** @param {RoadmapItem[] | null} routeItems */
function state(routeItems = items) {
  return /** @type {any} */ ({
    chrome: {},
    routes: {
      roadmap: {
        items: routeItems,
        expandedItemIds: new Set(),
        error: null,
      },
    },
  });
}

test('bucketRoadmapItems: creates the three fixed status columns and preserves item order', () => {
  const columns = bucketRoadmapItems([
    items[2],
    items[0],
    items[1],
    { ...items[0], id: 'live-2' },
  ]);

  assert.deepEqual(Object.keys(columns), ['LIVE', 'IN PROGRESS', 'UPCOMING']);
  assert.deepEqual(
    columns.LIVE.map((item) => item.id),
    ['live-1', 'live-2']
  );
  assert.deepEqual(
    columns['IN PROGRESS'].map((item) => item.id),
    ['doing-1']
  );
  assert.deepEqual(
    columns.UPCOMING.map((item) => item.id),
    ['next-1']
  );
});

test('roadmapReducer: loads rows without mutating route state', () => {
  const before = state(null);
  const after = roadmapReducer(before, {
    type: 'roadmap/loaded',
    items,
  });

  assert.notEqual(after, before);
  assert.equal(before.routes.roadmap.items, null);
  assert.equal(after.routes.roadmap.items, items);
});

test('roadmapReducer: toggles one expanded description immutably', () => {
  const before = state();
  const expanded = roadmapReducer(before, {
    type: 'roadmap/description-toggled',
    itemId: 'next-1',
  });
  const collapsed = roadmapReducer(expanded, {
    type: 'roadmap/description-toggled',
    itemId: 'next-1',
  });

  assert.equal(before.routes.roadmap.expandedItemIds.size, 0);
  assert.equal(expanded.routes.roadmap.expandedItemIds.has('next-1'), true);
  assert.equal(collapsed.routes.roadmap.expandedItemIds.has('next-1'), false);
});

test('roadmapView: renders card fields, labels, and three semantic columns', () => {
  const node = roadmapView(state(), { dispatch() {} });

  assert.equal(node.querySelectorAll('.cora-roadmap-column').length, 3);
  assert.match(node.textContent, /Live item/);
  assert.match(node.textContent, /Already delivered\./);
  assert.match(node.textContent, /ThemeCore/);
  assert.match(node.textContent, /2027P1/);
  assert.equal(node.innerHTML, '', 'user data is rendered as text nodes');
});

test('roadmapView: long descriptions dispatch toggle and expand/collapse in place', () => {
  /** @type {any[]} */
  const actions = [];
  const before = state();
  const collapsedView = roadmapView(before, {
    dispatch: (action) => actions.push(action),
  });
  const more = getByRole(collapsedView, 'button', { name: 'more...' });
  assert.ok(more);
  assert.equal(more.textContent, 'more...');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.ok(
    !collapsedView.textContent.includes(items[2].description),
    'collapsed card does not expose the full long description'
  );

  fireEvent(more, 'click');
  assert.deepEqual(actions, [
    { type: 'roadmap/description-toggled', itemId: 'next-1' },
  ]);

  const expandedState = roadmapReducer(before, actions[0]);
  const expandedView = roadmapView(expandedState, { dispatch() {} });
  const less = getByRole(expandedView, 'button', { name: 'less...' });
  assert.equal(less?.textContent, 'less...');
  assert.equal(less?.getAttribute('aria-expanded'), 'true');
  assert.match(expandedView.textContent, new RegExp(items[2].description));
});

test('createRouteSlice: loads through the client and owns full-width cleanup', async () => {
  /** @type {string[]} */
  const classes = [];
  /** @type {any[]} */
  const actions = [];
  const context = /** @type {any} */ ({
    chrome: {},
    client: { listRoadmapItems: async () => items },
    appEl: {
      classList: {
        add: (/** @type {string} */ value) => classes.push(`+${value}`),
        remove: (/** @type {string} */ value) => classes.push(`-${value}`),
      },
    },
  });
  const slice = createRouteSlice({}, context);
  const cleanup = slice.start({
    dispatch: (/** @type {any} */ action) => actions.push(action),
  });
  await Promise.resolve();

  assert.deepEqual(classes, ['+cora-fullbleed']);
  assert.deepEqual(actions, [{ type: 'roadmap/loaded', items }]);
  assert.equal(typeof cleanup, 'function');
  cleanup?.();
  assert.deepEqual(classes, ['+cora-fullbleed', '-cora-fullbleed']);
});
