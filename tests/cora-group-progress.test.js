// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

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
  // children = section rows + jump button
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const groupRows = children.filter((c) =>
    c.className.includes('cora-group-progress-row')
  );
  assert.equal(groupRows.length, 2);
});

test('CORAGroupProgress: each row shows group name', () => {
  const el = render([{ group: 'Opening', answered: 0, total: 1 }]);
  const row = /** @type {any} */ (el)._children[0];
  const label = row._children[0];
  assert.equal(label.textContent, 'Opening');
});

test('CORAGroupProgress: each row shows X/Y count', () => {
  const el = render([{ group: 'Opening', answered: 1, total: 3 }]);
  const row = /** @type {any} */ (el)._children[0];
  const count = row._children[1];
  assert.equal(count.textContent, '1/3');
});

test('CORAGroupProgress: completed groups have a distinct class', () => {
  const el = render([
    { group: 'Done', answered: 2, total: 2 },
    { group: 'Pending', answered: 1, total: 3 },
  ]);
  const rows = /** @type {any} */ (el)._children;
  assert.ok(rows[0].className.includes('complete'));
  assert.ok(!rows[1].className.includes('complete'));
});

test('CORAGroupProgress: clicking a row dispatches cora-group-jump with group name', () => {
  const el = new CORAGroupProgress();
  /** @type {any[]} */
  const dispatched = [];
  /** @type {any} */ (el)._listeners = /** @type {any} */ (el)._listeners ?? {};
  /** @type {any} */ (el).dispatchEvent = (/** @type {any} */ ev) =>
    dispatched.push(ev);

  el.update([{ group: 'Opening', answered: 0, total: 1 }], []);
  const row = /** @type {any} */ (el)._children[0];
  row._listeners['click']?.[0]({ currentTarget: row });

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'cora-group-jump');
  assert.equal(dispatched[0].detail?.group, 'Opening');
});

test('CORAGroupProgress: "Jump to next unanswered" button is rendered', () => {
  const el = new CORAGroupProgress();
  el.update([{ group: 'Opening', answered: 0, total: 1 }], []);
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  // The jump button should be among the children (possibly first or last).
  const hasJumpBtn = children.some(
    (c) => c.textContent && c.textContent.includes('next unanswered')
  );
  assert.ok(hasJumpBtn, 'Jump to next unanswered button should be present');
});

test('CORAGroupProgress: "Jump to next unanswered" dispatches cora-jump-unanswered', () => {
  const el = new CORAGroupProgress();
  /** @type {any[]} */
  const dispatched = [];
  /** @type {any} */ (el).dispatchEvent = (/** @type {any} */ ev) =>
    dispatched.push(ev);

  el.update([{ group: 'Opening', answered: 0, total: 1 }], []);
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const jumpBtn = children.find(
    (c) => c.textContent && c.textContent.includes('next unanswered')
  );
  jumpBtn._listeners['click']?.[0]({});

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'cora-jump-unanswered');
});

test('CORAGroupProgress: update with empty groups renders no group rows', () => {
  const el = render([]);
  // Only the jump button should remain
  const children = /** @type {any[]} */ (/** @type {any} */ (el)._children);
  const groupRows = children.filter(
    (c) => c.textContent && !c.textContent.includes('next unanswered')
  );
  assert.equal(groupRows.length, 0);
});
