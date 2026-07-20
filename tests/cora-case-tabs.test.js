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
    dirty: false,
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
    dirty: false,
    onSelect() {},
    onRevert() {},
    onCompile() {},
  });
  assert.equal(nav.querySelectorAll('.case-tab').length, 0);
});
