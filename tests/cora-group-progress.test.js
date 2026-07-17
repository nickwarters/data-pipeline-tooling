// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole, getByText } from './helpers/semantic-dom.js';

installDom();

// ===== IMPORTS =====
const { CORAGroupProgress, GroupProgress } =
  await import('../src/components/base/cora-group-progress.js');

/** @typedef {import('../src/evaluators/question-group-progress.js').QuestionGroupProgress} QuestionGroupProgress */

// ===== HELPERS =====

/** @param {QuestionGroupProgress[]} groups */
function render(groups) {
  const el = new CORAGroupProgress();
  el.update(groups, []);
  return el;
}

// ===== TESTS =====

test('GroupProgress: plain function renders rows and jump button', () => {
  const nodes = GroupProgress({
    groups: [{ group: 'Opening', answered: 1, total: 2 }],
    unansweredQuestions: [],
    onGroupJump: () => {},
    onJumpUnanswered: () => {},
  });

  assert.equal(
    /** @type {any} */ (nodes[0]).className,
    'cora-group-progress-row'
  );
  assert.equal(
    /** @type {any} */ (nodes[1]).className,
    'cora-jump-unanswered-btn'
  );
});

test('CORAGroupProgress: update renders one row per Question Group', () => {
  const el = render([
    { group: 'Opening', answered: 1, total: 1 },
    { group: 'Discovery', answered: 0, total: 2 },
  ]);
  assert.equal(el.querySelectorAll('.cora-group-progress-row').length, 2);
});

test('CORAGroupProgress: each row shows group name', () => {
  const el = render([{ group: 'Opening', answered: 0, total: 1 }]);
  assert.equal(getByText(el, 'Opening').textContent, 'Opening');
});

test('CORAGroupProgress: each row shows X/Y count', () => {
  const el = render([{ group: 'Opening', answered: 1, total: 3 }]);
  assert.equal(getByText(el, '1/3').textContent, '1/3');
});

test('CORAGroupProgress: completed groups have a distinct class', () => {
  const el = render([
    { group: 'Done', answered: 2, total: 2 },
    { group: 'Pending', answered: 1, total: 3 },
  ]);
  assert.ok(getByText(el, 'Done').parentNode.className.includes('complete'));
  assert.ok(
    !getByText(el, 'Pending').parentNode.className.includes('complete')
  );
});

test('CORAGroupProgress: clicking a row dispatches cora-group-jump with group name', () => {
  const el = new CORAGroupProgress();
  /** @type {any[]} */ const dispatched = [];
  el.addEventListener('cora-group-jump', (event) => dispatched.push(event));

  el.update([{ group: 'Opening', answered: 0, total: 1 }], []);
  fireEvent(getByText(el, 'Opening').parentNode, 'click');

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'cora-group-jump');
  assert.equal(dispatched[0].detail?.group, 'Opening');
});

test('CORAGroupProgress: "Jump to next unanswered" button is rendered', () => {
  const el = new CORAGroupProgress();
  el.update([{ group: 'Opening', answered: 0, total: 1 }], []);
  assert.equal(
    getByRole(el, 'button', { name: 'Jump to next unanswered' }).textContent,
    'Jump to next unanswered'
  );
});

test('CORAGroupProgress: "Jump to next unanswered" dispatches cora-jump-unanswered', () => {
  const el = new CORAGroupProgress();
  /** @type {any[]} */ const dispatched = [];
  el.addEventListener('cora-jump-unanswered', (event) =>
    dispatched.push(event)
  );

  el.update([{ group: 'Opening', answered: 0, total: 1 }], []);
  fireEvent(
    getByRole(el, 'button', { name: 'Jump to next unanswered' }),
    'click'
  );

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'cora-jump-unanswered');
});

test('CORAGroupProgress: update with empty groups renders no group rows', () => {
  const el = render([]);
  assert.equal(el.querySelectorAll('.cora-group-progress-row').length, 0);
});
