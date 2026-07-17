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
  getByText,
  queryAllByTag,
} from './helpers/semantic-dom.js';
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

test('CORAQuestionLabels: no question → nothing renders', () => {
  const e = /** @type {any} */ (new CORAQuestionLabels());
  e.connectedCallback();
  assert.equal(e.childElementCount, 0);
});

test('CORAQuestionLabels: renders a pill per assigned label', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[1]; // two labels
  const e = mount(q, bank);
  const names = e
    .querySelectorAll('.label-pill-name')
    .map((/** @type {any} */ name) => name.textContent);
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
  const name = e.querySelector('.label-pill-name');
  assert.equal(name.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(name.innerHTML, '');
});

test('CORAQuestionLabels: shows an empty hint when no labels assigned', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[3]; // q-channel, no labels
  const e = mount(q, bank);
  assert.equal(
    e.querySelector('.label-empty').className,
    'cora-empty label-empty'
  );
});

test('CORAQuestionLabels: an unassigned bank label shows as an add chip', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[0]); // only lbl-coaching
  const e = mount(q, bank);
  const chip = getByRole(e, 'button', { name: 'Regulatory' });
  assert.equal(chip.className, 'label-add-chip');
  fireEvent(chip, 'click');
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
  assert.deepEqual(q.labelIds, ['lbl-coaching', 'lbl-regulatory']);
});

test('CORAQuestionLabels: pill × unassigns and drops empty labelIds', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[0]); // single label
  const e = mount(q, bank);
  fireEvent(getByText(e, '×'), 'click');
  assert.equal('labelIds' in q, false);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
});

test('CORAQuestionLabels: editing a pill colour recolours the shared label', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[1];
  const e = mount(q, bank);
  const colorInput = e.querySelector('.label-pill-color');
  fireEvent(colorInput, 'change', { target: { value: '#00ff00' } });
  const label = /** @type {any[]} */ (bank.labels ?? []).find(
    (/** @type {any} */ l) => l.id === 'lbl-coaching'
  );
  assert.equal(label?.color, '#00ff00');
});

test('CORAQuestionLabels: creating a label adds it to the bank and assigns it', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[3]); // no labels
  const e = mount(q, bank);
  const nameInput = e.querySelector('.label-new-name');
  const colorInput = e.querySelector('.label-new-color');
  nameInput.value = 'Escalation';
  colorInput.value = '#777777';
  fireEvent(getByRole(e, 'button', { name: '+ new label' }), 'click');

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
  const nameInput = e.querySelector('.label-new-name');
  const before = (bank.labels ?? []).length;
  nameInput.value = '   ';
  fireEvent(getByRole(e, 'button', { name: '+ new label' }), 'click');
  assert.equal((bank.labels ?? []).length, before);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 0);
});

test('CORAQuestionLabels: a created label falls back to the default colour', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[3];
  const e = mount(q, bank);
  const nameInput = e.querySelector('.label-new-name');
  const colorInput = e.querySelector('.label-new-color');
  nameInput.value = 'Trend';
  colorInput.value = '';
  fireEvent(getByRole(e, 'button', { name: '+ new label' }), 'click');
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
  assert.ok(e.querySelector('.label-empty'));
  assert.equal(e.querySelectorAll('.label-pill').length, 0);
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
  assert.deepEqual(
    queryAllByTag(e, 'button').map((button) => button.textContent),
    ['+ new label']
  );
  // Creating a label initialises the bank's labels array.
  const nameInput = e.querySelector('.label-new-name');
  nameInput.value = 'First';
  fireEvent(getByRole(e, 'button', { name: '+ new label' }), 'click');
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
