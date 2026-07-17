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
  getByTag,
  getByText,
  queryAllByRole,
} from './helpers/semantic-dom.js';
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
  assert.equal(e.childElementCount, 0);
});

test('CORAShowwhenGroup: empty AND group renders head + empty children container', () => {
  const questions = freshExampleReviewBank().questions;
  const e = mount(questions[2], mkGroup(), { bankQuestions: questions });
  assert.ok(e.querySelector('.group-head'));
  assert.ok(e.querySelector('.group-children'));
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
  /** @type {any[]} */
  const alerts = [];
  /** @type {any} */ (globalThis).alert = (/** @type {string} */ m) =>
    alerts.push(m);
  fireEvent(getByRole(e, 'button', { name: '+ condition' }), 'click');
  assert.equal(alerts.length, 1);
  assert.equal(g.children.length, 0);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 0);
});

test('CORAShowwhenGroup: + condition appends a leaf when others exist', () => {
  const questions = freshExampleReviewBank().questions;
  const g = mkGroup();
  const e = mount(questions[2], g, { bankQuestions: questions });
  fireEvent(getByRole(e, 'button', { name: '+ condition' }), 'click');
  assert.equal(g.children.length, 1);
  assert.equal(g.children[0].type, 'leaf');
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
});

test('CORAShowwhenGroup: + group adds a flipped-op sub-group', () => {
  const questions = freshExampleReviewBank().questions;
  const g = mkGroup({ op: 'and' });
  const e = mount(questions[2], g, { bankQuestions: questions });
  fireEvent(getByRole(e, 'button', { name: '+ OR group' }), 'click');
  assert.equal(g.children[0].type, 'group');
  assert.equal(g.children[0].op, 'or');
});

test('CORAShowwhenGroup: op toggle flips AND ↔ OR', () => {
  const questions = freshExampleReviewBank().questions;
  const g = mkGroup();
  const e = mount(questions[2], g, { bankQuestions: questions });
  fireEvent(e.querySelector('.op-toggle'), 'click');
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
  assert.deepEqual(
    queryAllByRole(e, 'button').map((button) => button.textContent),
    ['+ condition', '+ OR group', '× group']
  );
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
  fireEvent(getByRole(e, 'button', { name: '× group' }), 'click');
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
  assert.ok(getByTag(e, 'cora-showwhen-leaf'));
  assert.ok(getByTag(e, 'cora-showwhen-group'));
  assert.equal(getByText(e, 'OR').parentNode.className, 'conjunction');
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
  const leafEl = getByTag(e, 'cora-showwhen-leaf');
  const groupEl = getByTag(e, 'cora-showwhen-group');
  assert.equal(leafEl.bankQuestions, questions);
  assert.equal(leafEl.onCommit, e.onCommit);
  assert.equal(groupEl.bankQuestions, questions);
  assert.equal(groupEl.onCommit, e.onCommit);
});
