// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  freshExampleReviewBank,
  commitSpy,
} from './_example-review-fixture.js';
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
  assert.equal(/** @type {any} */ (e)._children.length, 0);
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
  const row = /** @type {any} */ (e)._children[0];
  // qId select, op select, value input, leaf-x
  assert.equal(row._children.length, 4);
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
  const row = /** @type {any} */ (e)._children[0];
  const third = row._children[2];
  assert.equal(third.className, 'leaf-answered-hint');
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
  const row = /** @type {any} */ (e)._children[0];
  const valInput = row._children[2];
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
  const row = /** @type {any} */ (e)._children[0];
  const qSel = row._children[0];
  qSel._listeners.change[0]({ target: { value: 'q-channel' } });
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
  const row = /** @type {any} */ (e)._children[0];
  const opSel = row._children[1];

  opSel._listeners.change[0]({ target: { value: 'answered' } });
  assert.equal(leaf.op, 'answered');
  assert.equal(leaf.value, true);

  opSel._listeners.change[0]({ target: { value: 'in' } });
  assert.equal(leaf.op, 'in');
  assert.deepEqual(leaf.value, []);

  // Once op is 'in' and value is [], switching to equals coerces value to ''
  opSel._listeners.change[0]({ target: { value: 'equals' } });
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
  const row = /** @type {any} */ (e)._children[0];
  const opSel = row._children[1];
  opSel._listeners.change[0]({ target: { value: 'in' } });
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
  let row = /** @type {any} */ (e)._children[0];
  let val = row._children[2];
  val._listeners.change[0]({ target: { value: 'X, Y, ,Z' } });
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
  row = /** @type {any} */ (e2)._children[0];
  val = row._children[2];
  val._listeners.change[0]({ target: { value: 'No' } });
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
  const row = /** @type {any} */ (e)._children[0];
  const x = row._children[row._children.length - 1];
  x._listeners.click[0]();
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
  const row = /** @type {any} */ (e)._children[0];
  const valInput = row._children[2];
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
  const row = /** @type {any} */ (e)._children[0];
  const qSel = row._children[0];
  qSel._listeners.change[0]({ target: { value: 'q-channel' } });
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
  assert.equal(leaf.qId, 'q-channel');
});
