// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRShowwhenGroup } = await import('../src/cr-showwhen-group.js');
const { _resetStore, cases } = await import('../src/question-bank-store.js');

function mkGroup(over = {}) { return { type: 'group', op: 'and', children: [], ...over }; }

test('CRShowwhenGroup: missing question/group → no children', () => {
  const e = new CRShowwhenGroup();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CRShowwhenGroup: empty AND group renders head + empty children container', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[2];
  const g = mkGroup();
  const e = new CRShowwhenGroup();
  e.question = q; e.group = g; e.isRoot = true;
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 2);
  assert.ok(e.className.includes('op-and'));
});

test('CRShowwhenGroup: + condition appends a leaf, alerts when no other questions', () => {
  _resetStore();
  /** @type {any} */
  const lonely = { id: 'q-only', text: '', responseType: 'yes-no-na', deprecated: false };
  // Force currentBank to have only this question by mutating state
  cases.set({ 'hello-review': { label: 'L', slug: 'hello-review', eligibleGroups: [], questions: [lonely] } });
  const g = mkGroup();
  const e = new CRShowwhenGroup();
  e.question = lonely; e.group = g; e.isRoot = true;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  /** @type {any[]} */
  const alerts = [];
  (/** @type {any} */ (globalThis)).alert = (m) => alerts.push(m);
  const addCondBtn = actions._children[0];
  addCondBtn._listeners.click[0]();
  assert.equal(alerts.length, 1);
  assert.equal(g.children.length, 0);
});

test('CRShowwhenGroup: + condition appends a leaf when others exist', () => {
  _resetStore();
  const bank = cases.get()['hello-review'];
  const q = bank.questions[2];
  const g = mkGroup();
  const e = new CRShowwhenGroup();
  e.question = q; e.group = g; e.isRoot = true;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  actions._children[0]._listeners.click[0]();
  assert.equal(g.children.length, 1);
  assert.equal(g.children[0].type, 'leaf');
});

test('CRShowwhenGroup: + group adds a flipped-op sub-group', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[2];
  const g = mkGroup({ op: 'and' });
  const e = new CRShowwhenGroup();
  e.question = q; e.group = g; e.isRoot = true;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  actions._children[1]._listeners.click[0]();
  assert.equal(g.children[0].type, 'group');
  assert.equal(g.children[0].op, 'or');
});

test('CRShowwhenGroup: op toggle flips AND ↔ OR', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[2];
  const g = mkGroup();
  const e = new CRShowwhenGroup();
  e.question = q; e.group = g; e.isRoot = true;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const toggle = head._children[0];
  toggle._listeners.click[0]();
  assert.equal(g.op, 'or');
});

test('CRShowwhenGroup: non-root shows × group button', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[2];
  const g = mkGroup();
  const e = new CRShowwhenGroup();
  e.question = q; e.group = g; e.isRoot = false;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  // 3 children: + condition, + group, × group
  assert.equal(actions._children.length, 3);
});

test('CRShowwhenGroup: × group on non-root removes self from parent tree', async () => {
  _resetStore();
  // Use complaint-review's q-rootcause which already has a nested tree.
  const storeMod = await import('../src/question-bank-store.js');
  const q = storeMod.cases.get()['complaint-review'].questions[2];
  const { ensureTree } = await import('../src/question-bank-tree.js');
  const root = ensureTree(q);
  const innerOr = /** @type {any} */ (root.children.find(c => c.type === 'group' && c.op === 'or'));
  const before = root.children.length;
  const e = new CRShowwhenGroup();
  e.question = q; e.group = innerOr; e.isRoot = false;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[0];
  const actions = head._children[1];
  const removeBtn = actions._children[2];
  removeBtn._listeners.click[0]();
  assert.equal(root.children.length, before - 1);
});

test('CRShowwhenGroup: renders conjunctions between children + leaf/group mix', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[2];
  const g = mkGroup({
    op: 'or',
    children: [
      { type: 'leaf', qId: 'q-welcome', op: 'equals', value: 'Yes' },
      { type: 'group', op: 'and', children: [] },
    ],
  });
  const e = new CRShowwhenGroup();
  e.question = q; e.group = g; e.isRoot = true;
  e.connectedCallback();
  const childrenContainer = /** @type {any} */ (e)._children[1];
  // child0 (leaf), conjunction, child1 (group)
  assert.equal(childrenContainer._children.length, 3);
  assert.equal(childrenContainer._children[1].className, 'conjunction');
});
