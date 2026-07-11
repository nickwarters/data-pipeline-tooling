// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORAShowwhenGroup } =
  await import('../src/components/sections/cora-showwhen-group.js');
const { _resetStore, cases } =
  await import('../src/question-bank/question-bank-store.js');

/** @returns {{ type: string, op: string, children: any[] }} */
function mkGroup(over = {}) {
  return { type: 'group', op: 'and', children: [], ...over };
}

test('CORAShowwhenGroup: missing question/group → no children', () => {
  const e = new CORAShowwhenGroup();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAShowwhenGroup: empty AND group renders head + empty children container', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2];
  const g = mkGroup();
  const e = new CORAShowwhenGroup();
  e.question = q;
  e.group = g;
  e.isRoot = true;
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 2);
  assert.ok(e.className.includes('op-and'));
});

test('CORAShowwhenGroup: + condition appends a leaf, alerts when no other questions', () => {
  _resetStore();
  /** @type {any} */
  const lonely = {
    id: 'q-only',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
  };
  // Force currentBank to have only this question by mutating state
  cases.set({
    'example-review': {
      label: 'L',
      slug: 'example-review',
      eligibleGroups: [],
      questions: [lonely],
    },
  });
  const g = mkGroup();
  const e = new CORAShowwhenGroup();
  e.question = lonely;
  e.group = g;
  e.isRoot = true;
  e.connectedCallback();
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
});

test('CORAShowwhenGroup: + condition appends a leaf when others exist', () => {
  _resetStore();
  const bank = cases.get()['example-review'];
  const q = bank.questions[2];
  const g = mkGroup();
  const e = new CORAShowwhenGroup();
  e.question = q;
  e.group = g;
  e.isRoot = true;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  actions._children[0]._listeners.click[0]();
  assert.equal(g.children.length, 1);
  assert.equal(g.children[0].type, 'leaf');
});

test('CORAShowwhenGroup: + group adds a flipped-op sub-group', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2];
  const g = mkGroup({ op: 'and' });
  const e = new CORAShowwhenGroup();
  e.question = q;
  e.group = g;
  e.isRoot = true;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  actions._children[1]._listeners.click[0]();
  assert.equal(g.children[0].type, 'group');
  assert.equal(g.children[0].op, 'or');
});

test('CORAShowwhenGroup: op toggle flips AND ↔ OR', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2];
  const g = mkGroup();
  const e = new CORAShowwhenGroup();
  e.question = q;
  e.group = g;
  e.isRoot = true;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const toggle = head._children[0];
  toggle._listeners.click[0]();
  assert.equal(g.op, 'or');
});

test('CORAShowwhenGroup: non-root shows × group button', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2];
  const g = mkGroup();
  const e = new CORAShowwhenGroup();
  e.question = q;
  e.group = g;
  e.isRoot = false;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  // 3 children: + condition, + group, × group
  assert.equal(actions._children.length, 3);
});

test('CORAShowwhenGroup: × group on non-root removes self from parent tree', async () => {
  _resetStore();
  const storeMod = await import('../src/question-bank/question-bank-store.js');
  const q = storeMod.cases.get()['complaints'].questions[2];
  q.showWhen = {
    $and: [
      { 'q-cm-investigated': { equals: 'Yes' } },
      {
        $or: [
          { 'q-cm-ack': { equals: 'Yes' } },
          { 'q-cm-channel': { equals: 'Phone' } },
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
  const e = new CORAShowwhenGroup();
  e.question = q;
  e.group = innerOr;
  e.isRoot = false;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  const removeBtn = actions._children[2];
  removeBtn._listeners.click[0]();
  assert.equal(root.children.length, before - 1);
});

test('CORAShowwhenGroup: renders conjunctions between children + leaf/group mix', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2];
  const g = mkGroup({
    op: 'or',
    children: [
      { type: 'leaf', qId: 'q-welcome', op: 'equals', value: 'Yes' },
      { type: 'group', op: 'and', children: [] },
    ],
  });
  const e = new CORAShowwhenGroup();
  e.question = q;
  e.group = g;
  e.isRoot = true;
  e.connectedCallback();
  const childrenContainer = /** @type {any} */ (e)._children[1];
  // child0 (leaf), conjunction, child1 (group)
  assert.equal(childrenContainer._children.length, 3);
  assert.equal(childrenContainer._children[1].className, 'conjunction');
});
