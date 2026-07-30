// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole, getByText } from './helpers/semantic-dom.js';

installDom();
const { GroupProgress } =
  await import('../src/components/base/cora-group-progress.js');

test('GroupProgress renders counts, completion state, and reports navigation actions', () => {
  /** @type {any[]} */
  const actions = [];
  const root = document.createElement('section');
  root.append(
    ...GroupProgress({
      groups: [
        { group: 'Opening', answered: 1, total: 1 },
        { group: 'Discovery', answered: 0, total: 2 },
      ],
      unansweredQuestions: [],
      onGroupJump: (group) => actions.push(['group', group]),
      onJumpUnanswered: () => actions.push(['unanswered']),
    })
  );
  assert.ok(
    getByText(root, 'Opening').parentNode.className.includes('complete')
  );
  assert.match(root.textContent, /Opening1\/1Discovery0\/2/);
  assert.match(root.textContent, /^Jump to next unanswered/);
  fireEvent(getByText(root, 'Discovery').parentNode, 'click');
  fireEvent(
    getByRole(root, 'button', { name: 'Jump to next unanswered' }),
    'click'
  );
  assert.deepEqual(actions, [['group', 'Discovery'], ['unanswered']]);
});

test('GroupProgress with no groups renders only the jump action', () => {
  const nodes = GroupProgress({
    groups: [],
    unansweredQuestions: [],
    onGroupJump() {},
    onJumpUnanswered() {},
  });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].textContent, 'Jump to next unanswered');
});
