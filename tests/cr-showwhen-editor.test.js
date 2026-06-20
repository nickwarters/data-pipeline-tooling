// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRShowwhenEditor } =
  await import('../src/components/cr-showwhen-editor.js');
const { _resetStore, cases } =
  await import('../src/question-bank/question-bank-store.js');

test('CRShowwhenEditor: no question → renders nothing', () => {
  const e = new CRShowwhenEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CRShowwhenEditor: question without showWhen renders empty-state note', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[0];
  const e = new CRShowwhenEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  // header + empty-state + group
  assert.equal(wrap._children.length, 3);
  assert.equal(wrap._children[1].className, 'showwhen-empty');
});

test('CRShowwhenEditor: question with single condition omits empty-state', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[2]; // has showWhen
  const e = new CRShowwhenEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  // header + group (no empty)
  assert.equal(wrap._children.length, 2);
});

test('CRShowwhenEditor: nested tree reports depth in header', () => {
  _resetStore();
  // complaint-review has a 2-level deep tree
  const q = cases.get()['complaint-review'].questions[2];
  const e = new CRShowwhenEditor();
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
