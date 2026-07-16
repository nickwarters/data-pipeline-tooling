// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  freshExampleReviewBank,
  commitSpy,
} from './_example-review-fixture.js';
installDom();

const { CORAShowwhenGroup } =
  await import('../src/components/sections/cora-showwhen-group.js');
// Register the leaf element so child rows upgrade to real instances and the
// forwarding assertions below can read their properties.
await import('../src/components/base/cora-showwhen-leaf.js');

/** @returns {{ type: string, op: string, children: any[] }} */
function mkGroup(over = {}) {
  return { type: 'group', op: 'and', children: [], ...over };
}

/**
 * Mount a CORAShowwhenGroup with props and an onCommit spy (no store).
 * @param {any} q @param {any} g @param {{ isRoot?: boolean, bankQuestions?: any[] }} [opts]
 */
function mount(q, g, opts = {}) {
  const e = new CORAShowwhenGroup();
  e.question = q;
  e.group = g;
  e.isRoot = opts.isRoot ?? true;
  e.bankQuestions = opts.bankQuestions ?? [];
  e.onCommit = commitSpy();
  e.connectedCallback();
  return e;
}

test('CORAShowwhenGroup: missing question/group → no children', () => {
  const e = new CORAShowwhenGroup();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAShowwhenGroup: empty AND group renders head + empty children container', () => {
  const questions = freshExampleReviewBank().questions;
  const e = mount(questions[2], mkGroup(), { bankQuestions: questions });
  assert.equal(/** @type {any} */ (e)._children.length, 2);
  assert.ok(e.className.includes('op-and'));
});

test('CORAShowwhenGroup: + condition appends a leaf, alerts when no other questions', () => {
  /** @type {any} */
  const lonely = {
    id: 'q-only',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
  };
  const g = mkGroup();
  const e = mount(lonely, g, { bankQuestions: [lonely] });
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  /** @type {any[]} */
  const alerts = [];
  /** @type {any} */ (globalThis).alert = (/** @type {string} */ m) =>
    alerts.push(m);
  const addCondBtn = actions._children[0];
  addCondBtn._listeners.click[0]();
  assert.equal(alerts.length, 1);
  assert.equal(g.children.length, 0);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 0);
});

test('CORAShowwhenGroup: + condition appends a leaf when others exist', () => {
  const questions = freshExampleReviewBank().questions;
  const g = mkGroup();
  const e = mount(questions[2], g, { bankQuestions: questions });
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  actions._children[0]._listeners.click[0]();
  assert.equal(g.children.length, 1);
  assert.equal(g.children[0].type, 'leaf');
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
});

test('CORAShowwhenGroup: + group adds a flipped-op sub-group', () => {
  const questions = freshExampleReviewBank().questions;
  const g = mkGroup({ op: 'and' });
  const e = mount(questions[2], g, { bankQuestions: questions });
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  actions._children[1]._listeners.click[0]();
  assert.equal(g.children[0].type, 'group');
  assert.equal(g.children[0].op, 'or');
});

test('CORAShowwhenGroup: op toggle flips AND ↔ OR', () => {
  const questions = freshExampleReviewBank().questions;
  const g = mkGroup();
  const e = mount(questions[2], g, { bankQuestions: questions });
  const head = /** @type {any} */ (e)._children[0];
  const toggle = head._children[0];
  toggle._listeners.click[0]();
  assert.equal(g.op, 'or');
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
});

test('CORAShowwhenGroup: non-root shows × group button', () => {
  const questions = freshExampleReviewBank().questions;
  const g = mkGroup();
  const e = mount(questions[2], g, {
    isRoot: false,
    bankQuestions: questions,
  });
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  // 3 children: + condition, + group, × group
  assert.equal(actions._children.length, 3);
});

test('CORAShowwhenGroup: × group on non-root removes self from parent tree', async () => {
  const questions = freshExampleReviewBank().questions;
  const q = questions[2];
  q.showWhen = {
    $and: [
      { 'q-welcome': { equals: 'Yes' } },
      {
        $or: [
          { 'q-needs': { equals: 'Yes' } },
          { 'q-channel': { equals: 'Phone' } },
        ],
      },
    ],
  };
  const { ensureTree } = await import('../src/lib/showwhen-tree.js');
  const root = ensureTree(q);
  const innerOr = /** @type {any} */ (
    root.children.find((c) => c.type === 'group' && c.op === 'or')
  );
  const before = root.children.length;
  const e = mount(q, innerOr, { isRoot: false, bankQuestions: questions });
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  const removeBtn = actions._children[2];
  removeBtn._listeners.click[0]();
  assert.equal(root.children.length, before - 1);
});

test('CORAShowwhenGroup: renders conjunctions between children + leaf/group mix', () => {
  const questions = freshExampleReviewBank().questions;
  const g = mkGroup({
    op: 'or',
    children: [
      { type: 'leaf', qId: 'q-welcome', op: 'equals', value: 'Yes' },
      { type: 'group', op: 'and', children: [] },
    ],
  });
  const e = mount(questions[2], g, { bankQuestions: questions });
  const childrenContainer = /** @type {any} */ (e)._children[1];
  // child0 (leaf), conjunction, child1 (group)
  assert.equal(childrenContainer._children.length, 3);
  assert.equal(childrenContainer._children[1].className, 'conjunction');
});

test('CORAShowwhenGroup: forwards bankQuestions + onCommit to child leaves and groups', () => {
  const questions = freshExampleReviewBank().questions;
  const g = mkGroup({
    op: 'or',
    children: [
      { type: 'leaf', qId: 'q-welcome', op: 'equals', value: 'Yes' },
      { type: 'group', op: 'and', children: [] },
    ],
  });
  const e = mount(questions[2], g, { bankQuestions: questions });
  const childrenContainer = /** @type {any} */ (e)._children[1];
  const leafEl = childrenContainer._children[0];
  const groupEl = childrenContainer._children[2];
  assert.equal(leafEl.bankQuestions, questions);
  assert.equal(leafEl.onCommit, e.onCommit);
  assert.equal(groupEl.bankQuestions, questions);
  assert.equal(groupEl.onCommit, e.onCommit);
});
