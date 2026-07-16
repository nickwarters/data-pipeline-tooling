// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  freshExampleReviewBank,
  commitSpy,
} from './_example-review-fixture.js';
installDom();

const { CORAShowwhenEditor } =
  await import('../src/components/sections/cora-showwhen-editor.js');
// Register the group element so the condition tree upgrades to a real
// instance and the forwarding assertions below can read its properties.
await import('../src/components/sections/cora-showwhen-group.js');

/** @param {any} el @returns {any} */
const wrapOf = (el) => el._children[0];
/** @param {any} el @returns {any} */
const selectOf = (el) =>
  wrapOf(el)._children[0]._children.find(
    (/** @type {any} */ child) => child.className === 'showwhen-mode'
  );
/** Fire a change on the mode select. @param {any} el @param {string} value */
function selectMode(el, value) {
  const select = selectOf(el);
  select.value = value;
  select.dispatchEvent({ type: 'change', target: select });
}

/** Mount an editor over a question with props + an onCommit spy (no store). */
function mount(/** @type {any} */ q, /** @type {any[]} */ bankQuestions = []) {
  const e = new CORAShowwhenEditor();
  e.question = q;
  e.bankQuestions = bankQuestions;
  e.onCommit = commitSpy();
  e.connectedCallback();
  return e;
}

test('CORAShowwhenEditor: no question → renders nothing', () => {
  const e = new CORAShowwhenEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAShowwhenEditor: question without conditions defaults to Always and hides the section', () => {
  const q = freshExampleReviewBank().questions[0];
  const e = mount(q);
  const wrap = wrapOf(e);
  assert.equal(wrap._children.length, 1); // header only
  assert.equal(selectOf(e).value, 'always');
});

test('CORAShowwhenEditor: question with conditions defaults to Conditional and shows the section', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[2]; // has showWhen
  const e = mount(q, bank.questions);
  const wrap = wrapOf(e);
  assert.equal(wrap._children.length, 2); // header + group
  assert.equal(selectOf(e).value, 'conditional');
});

test('CORAShowwhenEditor: selecting Conditional on an empty question reveals the section', () => {
  const q = freshExampleReviewBank().questions[0]; // no conditions
  const e = mount(q);

  selectMode(e, 'conditional');

  const wrap = wrapOf(e);
  // header + empty-state note + group
  assert.equal(wrap._children.length, 3);
  assert.equal(wrap._children[1].className, 'cora-empty showwhen-empty');
  assert.equal(selectOf(e).value, 'conditional');
});

test('CORAShowwhenEditor: selecting Always clears the conditions and hides the section', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[2]; // has showWhen
  const e = mount(q, bank.questions);

  selectMode(e, 'always');

  assert.equal('showWhen' in q, false); // conditions cleared outright
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
  const wrap = wrapOf(e);
  assert.equal(wrap._children.length, 1); // section hidden
  assert.equal(selectOf(e).value, 'always');
});

test('CORAShowwhenEditor: toggling Conditional then back to Always hides an empty section again', () => {
  const q = freshExampleReviewBank().questions[0]; // no conditions
  const e = mount(q);

  selectMode(e, 'conditional');
  assert.equal(wrapOf(e)._children.length, 3);

  selectMode(e, 'always');
  assert.equal(wrapOf(e)._children.length, 1);
  assert.equal('showWhen' in q, false);
});

test('CORAShowwhenEditor: nested tree reports depth in header desc when conditional', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[2];
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
  const e = mount(q, bank.questions);
  const header = wrapOf(e)._children[0];
  const desc = header._children.find(
    (/** @type {any} */ child) => child.className === 'showwhen-desc'
  );
  const txt = desc._children[0]?.textContent ?? desc.textContent;
  assert.ok(txt.includes('conditions'));
  assert.ok(txt.includes('levels'));
  assert.equal(
    header._children.at(-1),
    selectOf(e),
    'the mode select stays at the header end when a conditional description is shown'
  );
});

test('CORAShowwhenEditor: forwards bankQuestions + onCommit to the condition tree', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[2]; // has showWhen
  const e = mount(q, bank.questions);
  const wrap = wrapOf(e);
  const grp = /** @type {any} */ (wrap._children[1]);
  assert.equal(grp.bankQuestions, bank.questions);
  assert.equal(grp.onCommit, e.onCommit);
});
