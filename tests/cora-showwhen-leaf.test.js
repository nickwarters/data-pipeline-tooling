// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  freshExampleReviewBank,
  commitSpy,
} from './_example-review-fixture.js';
import {
  fireEvent,
  getByRole,
  getByText,
  queryAllByRole,
} from './helpers/semantic-dom.js';
installDom();

const { CORAShowwhenLeaf } =
  await import('../src/components/base/cora-showwhen-leaf.js');

function mkLeaf(over = {}) {
  return {
    type: 'leaf',
    qId: 'q-welcome',
    op: 'equals',
    value: 'Yes',
    ...over,
  };
}

test('CORAShowwhenLeaf: no question/leaf → renders nothing', () => {
  const e = new CORAShowwhenLeaf();
  e.connectedCallback();
  assert.equal(e.childElementCount, 0);
});

test('CORAShowwhenLeaf: equals op renders qId select, op select, and value input', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf();
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1]; // makes others = q[0], q[2..]
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  assert.equal(queryAllByRole(e, 'combobox').length, 2);
  assert.equal(queryAllByRole(e, 'textbox').length, 1);
  assert.equal(getByText(e, '×').textContent, '×');
});

test('CORAShowwhenLeaf: answered op renders hint instead of value input', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf({ op: 'answered', value: true });
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1];
  e.bankQuestions = others;
  e.onCommit = commitSpy();
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  const hint = e.querySelector('.leaf-answered-hint');
  assert.ok(hint);
  assert.equal(hint.textContent, '— any non-empty answer');
});

test('CORAShowwhenLeaf: in op renders comma-joined value', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf({ op: 'in', value: ['A', 'B'] });
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1];
  e.bankQuestions = others;
  e.onCommit = commitSpy();
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  const valInput = getByRole(e, 'textbox', { name: 'Condition value' });
  assert.equal(valInput.value, 'A, B');
});

test('CORAShowwhenLeaf: changing qId select updates leaf.qId', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf();
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1];
  e.bankQuestions = others;
  e.onCommit = commitSpy();
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  const qSel = getByRole(e, 'combobox', { name: 'Condition question' });
  fireEvent(qSel, 'change', { target: { value: 'q-channel' } });
  assert.equal(leaf.qId, 'q-channel');
});

test('CORAShowwhenLeaf: changing op to answered, in, equals normalises value', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf();
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1];
  e.bankQuestions = others;
  e.onCommit = commitSpy();
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  const opSel = getByRole(e, 'combobox', { name: 'Condition operator' });

  fireEvent(opSel, 'change', { target: { value: 'answered' } });
  assert.equal(leaf.op, 'answered');
  assert.equal(leaf.value, true);

  fireEvent(opSel, 'change', { target: { value: 'in' } });
  assert.equal(leaf.op, 'in');
  assert.deepEqual(leaf.value, []);

  // Once op is 'in' and value is [], switching to equals coerces value to ''
  fireEvent(opSel, 'change', { target: { value: 'equals' } });
  assert.equal(leaf.op, 'equals');
  assert.equal(leaf.value, '');
});

test('CORAShowwhenLeaf: in→in change preserves array; equals→in coerces string', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf({ op: 'in', value: ['A'] });
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1];
  e.bankQuestions = others;
  e.onCommit = commitSpy();
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  const opSel = getByRole(e, 'combobox', { name: 'Condition operator' });
  fireEvent(opSel, 'change', { target: { value: 'in' } });
  assert.deepEqual(leaf.value, ['A']);
});

test('CORAShowwhenLeaf: typed value commits — split for in, plain for equals', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf({ op: 'in', value: [] });
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1];
  e.bankQuestions = others;
  e.onCommit = commitSpy();
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  let val = getByRole(e, 'textbox', { name: 'Condition value' });
  fireEvent(val, 'change', { target: { value: 'X, Y, ,Z' } });
  assert.deepEqual(leaf.value, ['X', 'Y', 'Z']);

  // Switch to equals
  const leaf2 = mkLeaf();
  parent.children = [leaf2];
  const e2 = new CORAShowwhenLeaf();
  e2.question = others[1];
  e2.bankQuestions = others;
  e2.onCommit = commitSpy();
  e2.parent = parent;
  e2.leaf = leaf2;
  e2.connectedCallback();
  val = getByRole(e2, 'textbox', { name: 'Condition value' });
  fireEvent(val, 'change', { target: { value: 'No' } });
  assert.equal(leaf2.value, 'No');
});

test('CORAShowwhenLeaf: × removes self from parent', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf();
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1];
  e.bankQuestions = others;
  e.onCommit = commitSpy();
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  fireEvent(getByText(e, '×'), 'click');
  assert.equal(parent.children.length, 0);
});

test('CORAShowwhenLeaf: leaf.value undefined falls through to empty string', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf({ value: undefined });
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1];
  e.bankQuestions = others;
  e.onCommit = commitSpy();
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  const valInput = getByRole(e, 'textbox', { name: 'Condition value' });
  assert.equal(valInput.value, '');
});

test('CORAShowwhenLeaf: mutations flow through the onCommit prop', () => {
  const others = freshExampleReviewBank().questions;
  /** @type {any} */
  const parent = { children: [] };
  const leaf = mkLeaf();
  parent.children.push(leaf);
  const e = new CORAShowwhenLeaf();
  e.question = others[1];
  e.bankQuestions = others;
  e.onCommit = commitSpy();
  e.parent = parent;
  e.leaf = leaf;
  e.connectedCallback();
  const qSel = getByRole(e, 'combobox', { name: 'Condition question' });
  fireEvent(qSel, 'change', { target: { value: 'q-channel' } });
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
  assert.equal(leaf.qId, 'q-channel');
});
