// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  getByTestId,
  queryAllByTag,
  queryByRole,
} from './helpers/semantic-dom.js';
import {
  freshExampleReviewBank,
  commitSpy,
} from './_example-review-fixture.js';
installDom();

const { CORAQuestionCard } =
  await import('../src/components/sections/cora-question-card.js');
// Register the child editors so they upgrade to real instances and the
// forwarding assertions below can read their properties.
await import('../src/components/sections/cora-wording-editor.js');
await import('../src/components/base/cora-options-editor.js');
await import('../src/components/base/cora-question-labels.js');
await import('../src/components/sections/cora-showwhen-editor.js');
await import('../src/pages/question-bank/cora-remediation-actions-editor.js');

/**
 * Mount a question card with props + an onCommit spy (no store).
 * @param {any} bank @param {number} index @param {{ groupFilterActive?: boolean }} [opts]
 */
function mount(bank, index, opts = {}) {
  const e = new CORAQuestionCard();
  e.question = bank.questions[index];
  e.bank = bank;
  e.baselineQuestions = structuredClone(bank.questions);
  e.questionIndex = index;
  e.groupFilterActive = opts.groupFilterActive ?? false;
  e.onCommit = commitSpy();
  e.connectedCallback();
  return e;
}

/** @param {any} root @param {string} name */
function control(root, name) {
  return getByRole(root, 'combobox', { name });
}

/** @param {any} element @param {string} value */
function change(element, value) {
  element.value = value;
  fireEvent(element, 'change');
}

/** @param {any} root @param {string} name */
function button(root, name) {
  return getByRole(root, 'button', { name });
}

test('CORAQuestionCard: no question → nothing renders', () => {
  const e = new CORAQuestionCard();
  e.connectedCallback();
  assert.equal(e.childElementCount, 0);
});

test('CORAQuestionCard: yes-no-na shows failure-criteria field + fixed-option outcome mapping', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 0);
  assert.ok(control(e, 'Response Type'));
  assert.ok(control(e, 'Failure Criteria'));
  assert.ok(getByTag(e, 'cora-options-editor'));
});

test('CORAQuestionCard: outcome response type derives read-only options, drops stored options', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[3]); // q-channel single-choice
  const e = mount(bank, 3);
  change(control(e, 'Response Type'), 'outcome');
  assert.equal(q.responseType, 'outcome');
  assert.equal('options' in q, false);
  assert.equal('optionOutcomes' in q, false);
});

test('CORAQuestionCard: single-choice renders options-editor + no failure-criteria', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 3); // q-channel
  assert.ok(getByTag(e, 'cora-options-editor'));
  assert.equal(queryByRole(e, 'combobox', { name: 'Failure Criteria' }), null);
});

test('CORAQuestionCard: changing response-type to non-yes-no-na initialises options', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[0]);
  const e = mount(bank, 0);
  change(control(e, 'Response Type'), 'single-choice');
  assert.deepEqual(q.options, ['Option A', 'Option B']);
});

test('CORAQuestionCard: changing response-type to yes-no-na deletes options', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[3]); // q-channel single-choice
  const e = mount(bank, 3);
  change(control(e, 'Response Type'), 'yes-no-na');
  assert.equal('options' in q, false);
});

test('CORAQuestionCard: id-input commits trimmed value (falls back to old on empty)', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0];
  const e = mount(bank, 0);
  const idInput = getByRole(e, 'textbox', { name: 'Question ID' });
  change(idInput, '  q-new  ');
  assert.equal(q.id, 'q-new');
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
  change(idInput, '   ');
  assert.equal(q.id, 'q-new'); // empty trim → fallback (oldId at that moment)
});

test('CORAQuestionCard: category text commits to undefined when emptied', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0];
  const e = mount(bank, 0);
  const catInput = getByRole(e, 'textbox', { name: 'Category' });
  change(catInput, '');
  assert.equal(q.category, undefined);
});

test('CORAQuestionCard: failure-criteria — selecting "—" clears the field', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0]; // failureCriteria: 'No'
  const e = mount(bank, 0);
  change(control(e, 'Failure Criteria'), '—');
  assert.equal(q.failureCriteria, undefined);
});

test('CORAQuestionCard: deprecate / undeprecate icon toggles state', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0];
  const e = mount(bank, 0);
  const depBtn = button(e, 'Mark deprecated');
  fireEvent(depBtn, 'click');
  assert.equal(q.deprecated, true);
  fireEvent(depBtn, 'click');
  assert.equal(q.deprecated, false);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 2);
});

test('CORAQuestionCard: move buttons reorder questions via onCommit', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[1];
  const e = mount(bank, 1);
  const upBtn = button(e, 'Move question up');
  const downBtn = button(e, 'Move question down');

  assert.equal(upBtn.disabled, false);
  fireEvent(upBtn, 'click');
  assert.equal(bank.questions[0], q);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);

  fireEvent(downBtn, 'click');
  assert.equal(bank.questions[1], q);
});

test('CORAQuestionCard: filtered move skips questions from other groups', () => {
  /** @type {any} */
  const bank = {
    label: 'L',
    slug: 'example-review',
    eligibleGroups: [],
    questions: [
      {
        id: 'a1',
        text: 'A1',
        questionGroup: 'A',
        responseType: 'yes-no-na',
        deprecated: false,
      },
      {
        id: 'b1',
        text: 'B1',
        questionGroup: 'B',
        responseType: 'yes-no-na',
        deprecated: false,
      },
      {
        id: 'a2',
        text: 'A2',
        questionGroup: 'A',
        responseType: 'yes-no-na',
        deprecated: false,
      },
    ],
  };
  const e = mount(bank, 2, { groupFilterActive: true });
  fireEvent(button(e, 'Move question up'), 'click');
  assert.deepEqual(
    bank.questions.map((/** @type {any} */ item) => item.id),
    ['a2', 'a1', 'b1']
  );
});

test('CORAQuestionCard: boundary move buttons are disabled', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 0);
  assert.equal(button(e, 'Move question up').disabled, true);
  assert.equal(button(e, 'Move question down').disabled, false);
});

test('CORAQuestionCard: duplicate inserts a copy with -copy id', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0];
  const e = mount(bank, 0);
  const before = bank.questions.length;
  fireEvent(button(e, 'Duplicate question'), 'click');
  assert.equal(bank.questions.length, before + 1);
  assert.equal(bank.questions[1].id, q.id + '-copy');
});

test('CORAQuestionCard: delete removes after confirm; cancelled confirm is a no-op', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 0);
  const delBtn = button(e, 'Remove draft question');

  // Cancelled
  /** @type {any} */ (globalThis).confirm = () => false;
  const before = bank.questions.length;
  fireEvent(delBtn, 'click');
  assert.equal(bank.questions.length, before);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 0);

  // Confirmed
  /** @type {any} */ (globalThis).confirm = () => true;
  fireEvent(delBtn, 'click');
  assert.equal(bank.questions.length, before - 1);
});

test('CORAQuestionCard: showWhen + active marks card-stripe with ochre', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 2); // q-resolve has showWhen
  const stripe = getByTestId(e, 'conditional-indicator');
  assert.ok(stripe.style.cssText.includes('ochre'));
});

test('CORAQuestionCard: deprecated adds "deprecated" class to the card', () => {
  const bank = freshExampleReviewBank();
  bank.questions[0].deprecated = true;
  const e = mount(bank, 0);
  assert.ok(e.className.includes('deprecated'));
});

test('CORAQuestionCard: tolerates missing confirm() global', () => {
  /** @type {any} */ (globalThis).confirm = undefined;
  const bank = freshExampleReviewBank();
  const e = mount(bank, 0);
  fireEvent(button(e, 'Remove draft question'), 'click');
  /** @type {any} */ (globalThis).confirm = () => true;
});

test('CORAQuestionCard: forwards bank state + onCommit to its child editors', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 0);
  const wording = getByTag(e, 'cora-wording-editor');
  const options = getByTag(e, 'cora-options-editor');
  const labels = getByTag(e, 'cora-question-labels');
  const showwhen = getByTag(e, 'cora-showwhen-editor');
  const remediation = getByTag(e, 'cora-remediation-actions-editor');
  assert.equal(wording.onCommit, e.onCommit);
  assert.equal(wording.baselineQuestion.id, bank.questions[0].id);
  assert.equal(options.outcomeOptions, bank.outcomeOptions);
  assert.equal(options.onCommit, e.onCommit);
  assert.equal(labels.bank, bank);
  assert.equal(labels.onCommit, e.onCommit);
  assert.equal(showwhen.bankQuestions, bank.questions);
  assert.equal(showwhen.onCommit, e.onCommit);
  assert.equal(remediation.onCommit, e.onCommit);
  assert.deepEqual(
    queryAllByTag(e, 'cora-options-editor'),
    [options],
    'each editor is mounted once'
  );
});

test('CORAQuestionCard: question-group text commits and clears to undefined', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[0]);
  const e = mount(bank, 0);
  const groupInput = getByRole(e, 'textbox', { name: 'Question Group' });
  change(groupInput, 'Kick-off');
  assert.equal(q.questionGroup, 'Kick-off');
  change(groupInput, '');
  assert.equal(q.questionGroup, undefined);
});

test('CORAQuestionCard: _field/_text/_select helpers delegate to the shared builders', () => {
  const e = new CORAQuestionCard();
  const control = e._text('v', () => {});
  const field = e._field('Label', control);
  assert.equal(field.className, 'field');
  const select = e._select(['a', 'b'], 'b', () => {});
  assert.equal(select._children.length, 2);
  assert.equal(select._children[1].selected, true);
});
