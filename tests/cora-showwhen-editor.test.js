// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORAShowwhenEditor } =
  await import('../src/components/sections/cora-showwhen-editor.js');
const { _resetStore, cases } =
  await import('../src/question-bank/question-bank-store.js');

test('CORAShowwhenEditor: no question → renders nothing', () => {
  const e = new CORAShowwhenEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAShowwhenEditor: question without showWhen renders empty-state note', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[0];
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  // header + empty-state + group
  assert.equal(wrap._children.length, 3);
  assert.equal(wrap._children[1].className, 'showwhen-empty');
});

test('CORAShowwhenEditor: question with single condition omits empty-state', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2]; // has showWhen
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  // header + group (no empty)
  assert.equal(wrap._children.length, 2);
});

test('CORAShowwhenEditor: nested tree reports depth in header', () => {
  _resetStore();
  // complaint-review has a 2-level deep tree
  const q = cases.get()['complaint-review'].questions[2];
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const header = wrap._children[0];
  const desc = header._children[1];
  const txt = desc._children[0]?.textContent ?? desc.textContent;
  // 3 conditions total in the complaint-review showWhen, 2 levels deep
  assert.ok(txt.includes('conditions'));
  assert.ok(txt.includes('levels'));
});
