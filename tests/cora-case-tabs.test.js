// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, queryAllByRole } from './helpers/semantic-dom.js';

installDom();
const { CaseTabs } =
  await import('../src/components/collections/cora-case-tabs.js');

test('CaseTabs renders active Case Type counts and reports all actions', () => {
  /** @type {any[]} */
  const actions = [];
  const nav = CaseTabs({
    types: {
      alpha: { label: 'Alpha', questions: [{ id: 'a' }] },
      beta: { label: 'Beta', questions: [{ id: 'b' }, { id: 'c' }] },
    },
    active: 'beta',
    dirtySlugs: [],
    onSelect: (slug) => actions.push(['select', slug]),
    onRevert: () => actions.push(['revert']),
    onCompile: () => actions.push(['compile']),
  });
  const buttons = queryAllByRole(nav, 'button');
  assert.deepEqual(
    buttons.map((button) => button.textContent),
    ['Alpha1 q', 'Beta2 q', '↺ Revert', 'Compile & Submit ⌘↵']
  );
  assert.ok(buttons[1].className.includes('active'));
  fireEvent(buttons[0], 'click');
  fireEvent(buttons[2], 'click');
  fireEvent(buttons[3], 'click');
  assert.deepEqual(actions, [['select', 'alpha'], ['revert'], ['compile']]);
});

test('CaseTabs renders an empty tab strip when no Case Types are configured', () => {
  const nav = CaseTabs({
    types: {},
    active: '',
    dirtySlugs: [],
    onSelect() {},
    onRevert() {},
    onCompile() {},
  });
  assert.equal(nav.querySelectorAll('.case-tab').length, 0);
});

test('CaseTabs marks only the Case Types carrying unsynced edits', () => {
  const nav = CaseTabs({
    types: {
      alpha: { label: 'Alpha', questions: [{ id: 'a' }] },
      beta: { label: 'Beta', questions: [{ id: 'b' }, { id: 'c' }] },
    },
    active: 'alpha',
    dirtySlugs: ['beta'],
    onSelect() {},
    onRevert() {},
    onCompile() {},
  });
  const tabs = [...nav.querySelectorAll('.case-tab')];
  assert.equal(tabs[0].querySelector('.tab-dirty'), null);
  assert.ok(tabs[1].querySelector('.tab-dirty'));
  assert.equal(tabs[0].textContent, 'Alpha1 q');
  assert.match(tabs[1].textContent ?? '', /Beta2 q.+unsynced/);
});
