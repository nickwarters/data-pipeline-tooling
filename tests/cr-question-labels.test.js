// @ts-check
// TODO(simplify-ui): Rewrite these lifecycle-heavy tests around the
// future function-component API. Prefer asserting plain functions, h() output,
// reactive() updates, and route-shell behavior over manual connectedCallback()/
// disconnectedCallback() calls on custom element classes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRQuestionLabels, makeLabelId, DEFAULT_LABEL_COLOR } =
  await import('../src/components/cr-question-labels.js');
const { _resetStore, cases, activeSlug } =
  await import('../src/question-bank/question-bank-store.js');

/** The active bank's labels, cast to `any[]` (the typedef makes them optional). */
function labels() {
  return /** @type {any[]} */ (cases.get()['example-review'].labels);
}

/** Mount a labels editor bound to a question from the active bank. */
function mount(/** @type {any} */ q) {
  const e = new CRQuestionLabels();
  e.question = q;
  e.connectedCallback();
  return e;
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

test('CRQuestionLabels: no question → nothing renders', () => {
  const e = new CRQuestionLabels();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CRQuestionLabels: renders a pill per assigned label', () => {
  _resetStore();
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[1]; // two labels
  const e = mount(q);
  const { pillRow } = parts(e);
  assert.equal(pillRow._children.length, 2);
  const names = pillRow._children.map(
    (/** @type {any} */ p) => p._children[1].textContent
  );
  assert.deepEqual(names, ['Coaching', 'Regulatory']);
});

test('CRQuestionLabels: label names render as text, not HTML', () => {
  _resetStore();
  activeSlug.set('example-review');
  const bank = cases.get()['example-review'];
  bank.labels = [
    {
      id: 'lbl-danger',
      name: '<img src=x onerror=alert(1)>',
      color: '#111111',
    },
  ];
  const q = bank.questions[0];
  q.labelIds = ['lbl-danger'];

  const e = mount(q);
  const { pillRow } = parts(e);
  const name = pillRow._children[0]._children[1];
  assert.equal(name.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(name.innerHTML, '');
});

test('CRQuestionLabels: shows an empty hint when no labels assigned', () => {
  _resetStore();
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[3]; // q-channel, no labels
  const e = mount(q);
  const { pillRow } = parts(e);
  assert.equal(pillRow._children.length, 1);
  assert.equal(pillRow._children[0].className, 'label-empty');
});

test('CRQuestionLabels: an unassigned bank label shows as an add chip', () => {
  _resetStore();
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[0]; // only lbl-coaching
  const e = mount(q);
  const { addRow } = parts(e);
  // [chip(Regulatory), create-control]
  assert.equal(addRow._children.length, 2);
  const chip = addRow._children[0];
  assert.equal(chip.className, 'label-add-chip');
  chip._listeners.click[0]();
  assert.deepEqual(cases.get()['example-review'].questions[0].labelIds, [
    'lbl-coaching',
    'lbl-regulatory',
  ]);
});

test('CRQuestionLabels: pill × unassigns and drops empty labelIds', () => {
  _resetStore();
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[0]; // single label
  const e = mount(q);
  const { pillRow } = parts(e);
  const x = pillRow._children[0]._children[2];
  x._listeners.click[0]();
  assert.equal('labelIds' in cases.get()['example-review'].questions[0], false);
});

test('CRQuestionLabels: editing a pill colour recolours the shared label', () => {
  _resetStore();
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[1];
  const e = mount(q);
  const { pillRow } = parts(e);
  const colorInput = pillRow._children[0]._children[0];
  colorInput._listeners.change[0]({ target: { value: '#00ff00' } });
  const label = labels().find(
    (/** @type {any} */ l) => l.id === 'lbl-coaching'
  );
  assert.equal(label.color, '#00ff00');
});

test('CRQuestionLabels: creating a label adds it to the bank and assigns it', () => {
  _resetStore();
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[3]; // no labels
  const e = mount(q);
  const create = parts(e).addRow._children.at(-1);
  const [nameInput, colorInput, addBtn] = create._children;
  nameInput.value = 'Escalation';
  colorInput.value = '#777777';
  addBtn._listeners.click[0]();

  const bank = cases.get()['example-review'];
  const created = labels().find(
    (/** @type {any} */ l) => l.name === 'Escalation'
  );
  assert.ok(created, 'new label exists on the bank');
  assert.equal(created.id, 'lbl-escalation');
  assert.equal(created.color, '#777777');
  assert.deepEqual(bank.questions[3].labelIds, ['lbl-escalation']);
});

test('CRQuestionLabels: creating with a blank name is a no-op', () => {
  _resetStore();
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[3];
  const e = mount(q);
  const create = parts(e).addRow._children.at(-1);
  const [nameInput, , addBtn] = create._children;
  const before = labels().length;
  nameInput.value = '   ';
  addBtn._listeners.click[0]();
  assert.equal(labels().length, before);
});

test('CRQuestionLabels: a created label falls back to the default colour', () => {
  _resetStore();
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[3];
  const e = mount(q);
  const create = parts(e).addRow._children.at(-1);
  const [nameInput, colorInput, addBtn] = create._children;
  nameInput.value = 'Trend';
  colorInput.value = '';
  addBtn._listeners.click[0]();
  const created = labels().find((/** @type {any} */ l) => l.name === 'Trend');
  assert.equal(created.color, DEFAULT_LABEL_COLOR);
});

test('CRQuestionLabels: ids referencing a missing label are skipped', () => {
  _resetStore();
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[3];
  q.labelIds = ['lbl-ghost'];
  const e = mount(q);
  const { pillRow } = parts(e);
  assert.equal(pillRow._children.length, 1);
  assert.equal(pillRow._children[0].className, 'label-empty');
});

test('CRQuestionLabels: tolerates a bank with no labels array', () => {
  cases.set({
    'example-review': {
      label: 'L',
      slug: 'example-review',
      eligibleGroups: [],
      questions: [
        /** @type {any} */ ({
          id: 'q',
          text: '',
          responseType: 'yes-no-na',
          deprecated: false,
        }),
      ],
    },
  });
  activeSlug.set('example-review');
  const q = cases.get()['example-review'].questions[0];
  const e = mount(q);
  // No bank labels → no add chips, just the create control.
  assert.equal(parts(e).addRow._children.length, 1);
  // Creating a label initialises the bank's labels array.
  const create = parts(e).addRow._children.at(-1);
  const [nameInput, , addBtn] = create._children;
  nameInput.value = 'First';
  addBtn._listeners.click[0]();
  assert.equal(labels().length, 1);
  _resetStore();
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
