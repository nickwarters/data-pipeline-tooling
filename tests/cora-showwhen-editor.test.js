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
/** Fire a change on the mode select. @param {any} el @param {string} value */
function selectMode(el, value) {
  const select = selectOf(el);
  select.value = value;
  select.dispatchEvent({ type: 'change', target: select });
}

/** Mount an editor over a store-backed question. */
function mount(/** @type {any} */ q) {
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.connectedCallback();
  return e;
}

test('CORAShowwhenEditor: no question → renders nothing', () => {
  const e = new CORAShowwhenEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAShowwhenEditor: question without conditions defaults to Always and hides the section', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[0];
  const e = mount(q);
  const wrap = wrapOf(e);
  assert.equal(wrap._children.length, 1); // header only
  assert.equal(selectOf(e).value, 'always');
});

test('CORAShowwhenEditor: question with conditions defaults to Conditional and shows the section', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2]; // has showWhen
  const e = mount(q);
  const wrap = wrapOf(e);
  assert.equal(wrap._children.length, 2); // header + group
  assert.equal(selectOf(e).value, 'conditional');
});

test('CORAShowwhenEditor: selecting Conditional on an empty question reveals the section', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[0]; // no conditions
  const e = mount(q);

  selectMode(e, 'conditional');

  const wrap = wrapOf(e);
  // header + empty-state note + group
  assert.equal(wrap._children.length, 3);
  assert.equal(wrap._children[1].className, 'showwhen-empty');
  assert.equal(selectOf(e).value, 'conditional');
});

test('CORAShowwhenEditor: selecting Always clears the conditions and hides the section', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2]; // has showWhen
  const e = mount(q);

  selectMode(e, 'always');

  assert.equal('showWhen' in q, false); // conditions cleared outright
  const wrap = wrapOf(e);
  assert.equal(wrap._children.length, 1); // section hidden
  assert.equal(selectOf(e).value, 'always');
});

test('CORAShowwhenEditor: toggling Conditional then back to Always hides an empty section again', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[0]; // no conditions
  const e = mount(q);

  selectMode(e, 'conditional');
  assert.equal(wrapOf(e)._children.length, 3);

  selectMode(e, 'always');
  assert.equal(wrapOf(e)._children.length, 1);
  assert.equal('showWhen' in q, false);
});

test('CORAShowwhenEditor: nested tree reports depth in header desc when conditional', () => {
  _resetStore();
  const q = cases.get()['complaints'].questions[2];
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
  const e = mount(q);
  const header = wrapOf(e)._children[0];
  const desc = header._children[2];
  const txt = desc._children[0]?.textContent ?? desc.textContent;
  assert.ok(txt.includes('conditions'));
  assert.ok(txt.includes('levels'));
});
