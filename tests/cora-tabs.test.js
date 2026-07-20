// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';

installDom();
const { Tabs, activeTabId, visibleTabs, nextTabId } =
  await import('../src/components/base/cora-tabs.js');

const TABS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie' },
];

/** @param {Partial<Parameters<typeof Tabs>[0]>} [overrides] */
function render(overrides = {}) {
  return Tabs({
    tabs: TABS,
    panels: {},
    selected: 'a',
    uid: 'test-tabs',
    focusId: '',
    onSelect: () => {},
    onKeydown: () => {},
    onFocusTarget: () => {},
    ...overrides,
  });
}

test('visibleTabs and activeTabId ignore hidden tabs and fall back safely', () => {
  const tabs = [TABS[0], { ...TABS[1], hidden: true }, TABS[2]];
  assert.deepEqual(
    visibleTabs(tabs).map((tab) => tab.id),
    ['a', 'c']
  );
  assert.equal(activeTabId(tabs, 'b'), 'a');
  assert.equal(activeTabId([], 'missing'), '');
});

test('nextTabId wraps in both directions and skips hidden tabs', () => {
  const tabs = [TABS[0], { ...TABS[1], hidden: true }, TABS[2]];
  assert.equal(nextTabId(tabs, 'a', 'ArrowRight'), 'c');
  assert.equal(nextTabId(tabs, 'a', 'ArrowLeft'), 'c');
  assert.equal(nextTabId(tabs, 'a', 'Enter'), 'a');
});

test('Tabs: renders an ARIA tablist with selected/focusable state and linked panels', () => {
  const nodes = render({ selected: 'b' });
  const tablist = /** @type {any} */ (nodes[0]);
  const panels = /** @type {any[]} */ (nodes.slice(1));
  const buttons = tablist.querySelectorAll('[role="tab"]');
  assert.equal(tablist.getAttribute('role'), 'tablist');
  assert.equal(buttons.length, 3);
  assert.deepEqual(
    buttons.map((/** @type {any} */ button) =>
      button.getAttribute('aria-selected')
    ),
    ['false', 'true', 'false']
  );
  assert.deepEqual(
    buttons.map((/** @type {any} */ button) => button.getAttribute('tabindex')),
    ['-1', '0', '-1']
  );
  assert.equal(panels.filter((panel) => !panel.hidden).length, 1);
  assert.equal(panels[1].getAttribute('aria-labelledby'), buttons[1].id);
});

test('Tabs: omits hidden tabs and places supplied panel content', () => {
  const content = new StubEl('p');
  content.textContent = 'Panel A';
  const nodes = render({
    tabs: [TABS[0], { ...TABS[1], hidden: true }],
    panels: { a: /** @type {any} */ (content) },
  });
  assert.equal(
    /** @type {any} */ (nodes[0]).querySelectorAll('[role="tab"]').length,
    1
  );
  assert.equal(/** @type {any} */ (nodes[1]).querySelector('p'), content);
});

test('Tabs: delegates click and keydown actions without owning state', () => {
  /** @type {string[]} */
  const selected = [];
  /** @type {string[]} */
  const keys = [];
  const nodes = render({
    onSelect: (id) => selected.push(id),
    onKeydown: (event) => keys.push(event.key),
  });
  const buttons = /** @type {any} */ (nodes[0]).querySelectorAll(
    '[role="tab"]'
  );
  buttons[1].dispatchEvent({ type: 'click' });
  buttons[0].dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.deepEqual(selected, ['b']);
  assert.deepEqual(keys, ['ArrowRight']);
});
