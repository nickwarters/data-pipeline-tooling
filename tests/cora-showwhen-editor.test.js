// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORAShowwhenEditor } =
  await import('../src/components/sections/cora-showwhen-editor.js');
const { _resetStore, cases } =
  await import('../src/question-bank/question-bank-store.js');

/** @param {any} el @returns {any} */
const wrapOf = (el) => el._children[0];
/** @param {any} el @returns {any} */
const selectOf = (el) => wrapOf(el)._children[0]._children[1];

test('CORAShowwhenEditor: no question → renders nothing', () => {
  const e = new CORAShowwhenEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAShowwhenEditor: question without showWhen defaults to Always and hides the section', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[0];
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = wrapOf(e);
  // only the header (with mode select); no empty-state note, no group
  assert.equal(wrap._children.length, 1);
  assert.equal(selectOf(e).value, 'always');
});

test('CORAShowwhenEditor: question with conditions defaults to Conditional and shows the section', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2]; // has showWhen
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = wrapOf(e);
  // header + group (no empty-state, conditions exist)
  assert.equal(wrap._children.length, 2);
  assert.equal(selectOf(e).value, 'conditional');
});

test('CORAShowwhenEditor: selecting Conditional reveals the section with the empty-state note', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[0]; // no showWhen
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.connectedCallback();

  const select = selectOf(e);
  select.value = 'conditional';
  select.dispatchEvent({ type: 'change', target: select });

  const wrap = wrapOf(e);
  // header + empty-state + group
  assert.equal(wrap._children.length, 3);
  assert.equal(wrap._children[1].className, 'showwhen-empty');
});

test('CORAShowwhenEditor: selecting Always hides the section without discarding conditions', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2]; // has showWhen
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.connectedCallback();

  const select = selectOf(e);
  select.value = 'always';
  select.dispatchEvent({ type: 'change', target: select });

  const wrap = wrapOf(e);
  // section collapsed to just the header ...
  assert.equal(wrap._children.length, 1);
  // ... but the underlying showWhen is untouched
  assert.ok(q.showWhen);
});

test('CORAShowwhenEditor: nested tree reports depth in header desc when conditional', () => {
  _resetStore();
  // complaint-review has a 2-level deep tree
  const q = cases.get()['complaint-review'].questions[2];
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = wrapOf(e);
  const header = wrap._children[0];
  const desc = header._children[2];
  const txt = desc._children[0]?.textContent ?? desc.textContent;
  // 3 conditions total in the complaint-review showWhen, 2 levels deep
  assert.ok(txt.includes('conditions'));
  assert.ok(txt.includes('levels'));
});
