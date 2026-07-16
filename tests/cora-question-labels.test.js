// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  freshExampleReviewBank,
  commitSpy,
} from './_example-review-fixture.js';
installDom();

const { CORAQuestionLabels, makeLabelId, DEFAULT_LABEL_COLOR } =
  await import('../src/components/base/cora-question-labels.js');

/** Mount a labels editor bound to a question with props + spy (no store). */
function mount(/** @type {any} */ q, /** @type {any} */ bank) {
  const e = new CORAQuestionLabels();
  e.question = q;
  e.bank = bank;
  e.onCommit = commitSpy();
  e.connectedCallback();
  return /** @type {any} */ (e);
}

/** The four children of the labels block: [label, help, pillRow, addRow]. */
function parts(/** @type {any} */ e) {
  const block = e._children[0];
  return {
    block,
    pillRow: block._children[2],
    addRow: block._children[3],
  };
}

test('CORAQuestionLabels: no question → nothing renders', () => {
  const e = /** @type {any} */ (new CORAQuestionLabels());
  e.connectedCallback();
  assert.equal(e._children.length, 0);
});

test('CORAQuestionLabels: renders a pill per assigned label', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[1]; // two labels
  const e = mount(q, bank);
  const { pillRow } = parts(e);
  assert.equal(pillRow._children.length, 2);
  const names = pillRow._children.map(
    (/** @type {any} */ p) => p._children[1].textContent
  );
  assert.deepEqual(names, ['Coaching', 'Regulatory']);
});

test('CORAQuestionLabels: label names render as text, not HTML', () => {
  const bank = freshExampleReviewBank();
  bank.labels = [
    {
      id: 'lbl-danger',
      name: '<img src=x onerror=alert(1)>',
      color: '#111111',
    },
  ];
  const q = /** @type {any} */ (bank.questions[0]);
  q.labelIds = ['lbl-danger'];

  const e = mount(q, bank);
  const { pillRow } = parts(e);
  const name = pillRow._children[0]._children[1];
  assert.equal(name.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(name.innerHTML, '');
});

test('CORAQuestionLabels: shows an empty hint when no labels assigned', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[3]; // q-channel, no labels
  const e = mount(q, bank);
  const { pillRow } = parts(e);
  assert.equal(pillRow._children.length, 1);
  assert.equal(pillRow._children[0].className, 'cora-empty label-empty');
});

test('CORAQuestionLabels: an unassigned bank label shows as an add chip', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[0]); // only lbl-coaching
  const e = mount(q, bank);
  const { addRow } = parts(e);
  // [chip(Regulatory), create-control]
  assert.equal(addRow._children.length, 2);
  const chip = addRow._children[0];
  assert.equal(chip.className, 'label-add-chip');
  chip._listeners.click[0]();
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
  assert.deepEqual(q.labelIds, ['lbl-coaching', 'lbl-regulatory']);
});

test('CORAQuestionLabels: pill × unassigns and drops empty labelIds', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[0]); // single label
  const e = mount(q, bank);
  const { pillRow } = parts(e);
  const x = pillRow._children[0]._children[2];
  x._listeners.click[0]();
  assert.equal('labelIds' in q, false);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
});

test('CORAQuestionLabels: editing a pill colour recolours the shared label', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[1];
  const e = mount(q, bank);
  const { pillRow } = parts(e);
  const colorInput = pillRow._children[0]._children[0];
  colorInput._listeners.change[0]({ target: { value: '#00ff00' } });
  const label = /** @type {any[]} */ (bank.labels ?? []).find(
    (/** @type {any} */ l) => l.id === 'lbl-coaching'
  );
  assert.equal(label?.color, '#00ff00');
});

test('CORAQuestionLabels: creating a label adds it to the bank and assigns it', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[3]); // no labels
  const e = mount(q, bank);
  const create = parts(e).addRow._children.at(-1);
  const [nameInput, colorInput, addBtn] = create._children;
  nameInput.value = 'Escalation';
  colorInput.value = '#777777';
  addBtn._listeners.click[0]();

  const created = /** @type {any[]} */ (bank.labels ?? []).find(
    (/** @type {any} */ l) => l.name === 'Escalation'
  );
  assert.ok(created, 'new label exists on the bank');
  assert.equal(created.id, 'lbl-escalation');
  assert.equal(created.color, '#777777');
  assert.deepEqual(q.labelIds, ['lbl-escalation']);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
});

test('CORAQuestionLabels: creating with a blank name is a no-op', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[3];
  const e = mount(q, bank);
  const create = parts(e).addRow._children.at(-1);
  const [nameInput, , addBtn] = create._children;
  const before = (bank.labels ?? []).length;
  nameInput.value = '   ';
  addBtn._listeners.click[0]();
  assert.equal((bank.labels ?? []).length, before);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 0);
});

test('CORAQuestionLabels: a created label falls back to the default colour', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[3];
  const e = mount(q, bank);
  const create = parts(e).addRow._children.at(-1);
  const [nameInput, colorInput, addBtn] = create._children;
  nameInput.value = 'Trend';
  colorInput.value = '';
  addBtn._listeners.click[0]();
  const created = /** @type {any[]} */ (bank.labels ?? []).find(
    (/** @type {any} */ l) => l.name === 'Trend'
  );
  assert.equal(created?.color, DEFAULT_LABEL_COLOR);
});

test('CORAQuestionLabels: ids referencing a missing label are skipped', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[3]);
  q.labelIds = ['lbl-ghost'];
  const e = mount(q, bank);
  const { pillRow } = parts(e);
  assert.equal(pillRow._children.length, 1);
  assert.equal(pillRow._children[0].className, 'cora-empty label-empty');
});

test('CORAQuestionLabels: tolerates a bank with no labels array', () => {
  /** @type {any} */
  const bank = {
    label: 'L',
    slug: 'example-review',
    eligibleGroups: [],
    questions: [
      {
        id: 'q',
        text: '',
        responseType: 'yes-no-na',
        deprecated: false,
      },
    ],
  };
  const q = bank.questions[0];
  const e = mount(q, bank);
  // No bank labels → no add chips, just the create control.
  assert.equal(parts(e).addRow._children.length, 1);
  // Creating a label initialises the bank's labels array.
  const create = parts(e).addRow._children.at(-1);
  const [nameInput, , addBtn] = create._children;
  nameInput.value = 'First';
  addBtn._listeners.click[0]();
  assert.equal(bank.labels.length, 1);
});

test('makeLabelId: slugifies a display name', () => {
  assert.equal(makeLabelId('Regulatory Risk!', []), 'lbl-regulatory-risk');
});

test('makeLabelId: disambiguates against existing ids', () => {
  assert.equal(makeLabelId('Coaching', ['lbl-coaching']), 'lbl-coaching-2');
  assert.equal(
    makeLabelId('Coaching', ['lbl-coaching', 'lbl-coaching-2']),
    'lbl-coaching-3'
  );
});

test('makeLabelId: falls back to "label" when the name has no usable chars', () => {
  assert.equal(makeLabelId('!!!', []), 'lbl-label');
});
