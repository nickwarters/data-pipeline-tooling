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

test('CORAShowwhenEditor: explicit showWhenMode override wins over the derived default', () => {
  _resetStore();
  // conditions present, but curator toggled to Always → section hidden
  const q = {
    ...cases.get()['example-review'].questions[2],
    showWhenMode: 'always',
  };
  const e = mount(q);
  assert.equal(wrapOf(e)._children.length, 1);
  assert.equal(selectOf(e).value, 'always');

  // no conditions, but curator toggled to Conditional → section revealed
  const q2 = {
    id: 'q-empty',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    showWhenMode: 'conditional',
  };
  const e2 = mount(q2);
  const wrap2 = wrapOf(e2);
  assert.equal(wrap2._children.length, 3); // header + empty-state + group
  assert.equal(wrap2._children[1].className, 'showwhen-empty');
});

test('CORAShowwhenEditor: selecting Conditional on an empty question records the deviating intent', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[0]; // no conditions
  const e = mount(q);

  const select = selectOf(e);
  select.value = 'conditional';
  select.dispatchEvent({ type: 'change', target: select });

  // conditional deviates from the derived "always" default → persisted
  assert.equal(q.showWhenMode, 'conditional');
});

test('CORAShowwhenEditor: selecting Always retains showWhen but records the intent', () => {
  _resetStore();
  const q = cases.get()['example-review'].questions[2]; // has showWhen
  const before = JSON.stringify(q.showWhen);
  const e = mount(q);

  const select = selectOf(e);
  select.value = 'always';
  select.dispatchEvent({ type: 'change', target: select });

  assert.equal(q.showWhenMode, 'always'); // deviates from derived "conditional"
  assert.equal(JSON.stringify(q.showWhen), before); // conditions untouched
});

test('CORAShowwhenEditor: selecting the derived default clears any recorded intent', () => {
  _resetStore();
  const q = {
    ...cases.get()['example-review'].questions[2],
    showWhenMode: 'always',
  };
  const e = mount(q);

  const select = selectOf(e);
  select.value = 'conditional'; // matches derived default (conditions present)
  select.dispatchEvent({ type: 'change', target: select });

  assert.equal('showWhenMode' in q, false);
});

test('CORAShowwhenEditor: nested tree reports depth in header desc when conditional', () => {
  _resetStore();
  const q = cases.get()['complaint-review'].questions[2]; // 2-level deep tree
  const e = mount(q);
  const header = wrapOf(e)._children[0];
  const desc = header._children[2];
  const txt = desc._children[0]?.textContent ?? desc.textContent;
  assert.ok(txt.includes('conditions'));
  assert.ok(txt.includes('levels'));
});
