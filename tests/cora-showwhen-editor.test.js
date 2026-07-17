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
  textContent,
} from './helpers/semantic-dom.js';
installDom();

const { CORAShowwhenEditor } =
  await import('../src/components/sections/cora-showwhen-editor.js');
// Register the group element so the condition tree upgrades to a real
// instance and the forwarding assertions below can read its properties.
await import('../src/components/sections/cora-showwhen-group.js');

/** @param {any} el @returns {any} */
const selectOf = (el) => getByRole(el, 'combobox', { name: 'Show when' });
/** Fire a change on the mode select. @param {any} el @param {string} value */
function selectMode(el, value) {
  const select = selectOf(el);
  select.value = value;
  fireEvent(select, 'change', { target: select });
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
  assert.equal(e.childElementCount, 0);
});

test('CORAShowwhenEditor: question without conditions defaults to Always and hides the section', () => {
  const q = freshExampleReviewBank().questions[0];
  const e = mount(q);
  assert.equal(e.querySelector('cora-showwhen-group'), null);
  assert.equal(e.querySelector('.showwhen-empty'), null);
  assert.equal(selectOf(e).value, 'always');
});

test('CORAShowwhenEditor: question with conditions defaults to Conditional and shows the section', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[2]; // has showWhen
  const e = mount(q, bank.questions);
  assert.ok(getByTag(e, 'cora-showwhen-group'));
  assert.equal(selectOf(e).value, 'conditional');
});

test('CORAShowwhenEditor: selecting Conditional on an empty question reveals the section', () => {
  const q = freshExampleReviewBank().questions[0]; // no conditions
  const e = mount(q);

  selectMode(e, 'conditional');

  const empty = e.querySelector('.showwhen-empty');
  assert.ok(empty);
  assert.equal(empty.className, 'cora-empty showwhen-empty');
  assert.ok(getByTag(e, 'cora-showwhen-group'));
  assert.equal(selectOf(e).value, 'conditional');
});

test('CORAShowwhenEditor: selecting Always clears the conditions and hides the section', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[2]; // has showWhen
  const e = mount(q, bank.questions);

  selectMode(e, 'always');

  assert.equal('showWhen' in q, false); // conditions cleared outright
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
  assert.equal(e.querySelector('cora-showwhen-group'), null);
  assert.equal(e.querySelector('.showwhen-empty'), null);
  assert.equal(selectOf(e).value, 'always');
});

test('CORAShowwhenEditor: toggling Conditional then back to Always hides an empty section again', () => {
  const q = freshExampleReviewBank().questions[0]; // no conditions
  const e = mount(q);

  selectMode(e, 'conditional');
  assert.ok(getByTag(e, 'cora-showwhen-group'));
  assert.ok(e.querySelector('.showwhen-empty'));

  selectMode(e, 'always');
  assert.equal(e.querySelector('cora-showwhen-group'), null);
  assert.equal(e.querySelector('.showwhen-empty'), null);
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
  const header = e.querySelector('.showwhen-header');
  assert.ok(header);
  const desc = header.querySelector('.showwhen-desc');
  assert.ok(desc);
  const txt = textContent(desc);
  assert.ok(txt.includes('conditions'));
  assert.ok(txt.includes('levels'));
  assert.equal(selectOf(e).parentNode, header);
});

test('CORAShowwhenEditor: forwards bankQuestions + onCommit to the condition tree', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[2]; // has showWhen
  const e = mount(q, bank.questions);
  const grp = getByTag(e, 'cora-showwhen-group');
  assert.equal(grp.bankQuestions, bank.questions);
  assert.equal(grp.onCommit, e.onCommit);
});
