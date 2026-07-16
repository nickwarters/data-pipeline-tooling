// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
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

test('CORAQuestionCard: no question → nothing renders', () => {
  const e = new CORAQuestionCard();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAQuestionCard: yes-no-na shows failure-criteria field + fixed-option outcome mapping', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 0);
  const head = /** @type {any} */ (e)._children[1];
  const body = head._children[1];
  // body kids: wording-editor, grid, options-editor (fixed Yes/No outcome
  // mapping), labels-editor, showwhen-editor, remediation-actions-editor
  assert.equal(body._children.length, 6);
  // grid has 4 fields: category, question-group, response-type, failure-criteria
  const grid = body._children[1];
  assert.equal(grid._children.length, 4);
});

test('CORAQuestionCard: outcome response type derives read-only options, drops stored options', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[3]); // q-channel single-choice
  const e = mount(bank, 3);
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const responseTypeField = grid._children[2];
  const select = responseTypeField._children[1];
  select._listeners.change[0]({ target: { value: 'outcome' } });
  assert.equal(q.responseType, 'outcome');
  assert.equal('options' in q, false);
  assert.equal('optionOutcomes' in q, false);
});

test('CORAQuestionCard: single-choice renders options-editor + no failure-criteria', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 3); // q-channel
  const body = /** @type {any} */ (e)._children[1]._children[1];
  // wording-editor, grid (2 fields), options-editor, labels, showwhen,
  // remediation
  assert.equal(body._children.length, 6);
});

test('CORAQuestionCard: changing response-type to non-yes-no-na initialises options', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[0]);
  const e = mount(bank, 0);
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const responseTypeField = grid._children[2];
  const select = responseTypeField._children[1];
  select._listeners.change[0]({ target: { value: 'single-choice' } });
  assert.deepEqual(q.options, ['Option A', 'Option B']);
});

test('CORAQuestionCard: changing response-type to yes-no-na deletes options', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[3]); // q-channel single-choice
  const e = mount(bank, 3);
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const responseTypeField = grid._children[2];
  const select = responseTypeField._children[1];
  select._listeners.change[0]({ target: { value: 'yes-no-na' } });
  assert.equal('options' in q, false);
});

test('CORAQuestionCard: id-input commits trimmed value (falls back to old on empty)', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0];
  const e = mount(bank, 0);
  const head = /** @type {any} */ (e)._children[1];
  const num = head._children[0];
  const idInput = num._children[1];
  idInput._listeners.change[0]({ target: { value: '  q-new  ' } });
  assert.equal(q.id, 'q-new');
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
  idInput._listeners.change[0]({ target: { value: '   ' } });
  assert.equal(q.id, 'q-new'); // empty trim → fallback (oldId at that moment)
});

test('CORAQuestionCard: category text commits to undefined when emptied', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0];
  const e = mount(bank, 0);
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const catField = grid._children[0];
  const catInput = catField._children[1];
  catInput._listeners.change[0]({ target: { value: '' } });
  assert.equal(q.category, undefined);
});

test('CORAQuestionCard: failure-criteria — selecting "—" clears the field', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0]; // failureCriteria: 'No'
  const e = mount(bank, 0);
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const fcField = grid._children[3];
  const select = fcField._children[1];
  select._listeners.change[0]({ target: { value: '—' } });
  assert.equal(q.failureCriteria, undefined);
});

test('CORAQuestionCard: deprecate / undeprecate icon toggles state', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0];
  const e = mount(bank, 0);
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  const depBtn = actions._children[2];
  depBtn._listeners.click[0]();
  assert.equal(q.deprecated, true);
  depBtn._listeners.click[0]();
  assert.equal(q.deprecated, false);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 2);
});

test('CORAQuestionCard: move buttons reorder questions via onCommit', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[1];
  const e = mount(bank, 1);
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  const upBtn = actions._children[0];
  const downBtn = actions._children[1];

  assert.equal(upBtn.disabled, false);
  upBtn._listeners.click[0]();
  assert.equal(bank.questions[0], q);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);

  downBtn._listeners.click[0]();
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
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  actions._children[0]._listeners.click[0]();
  assert.deepEqual(
    bank.questions.map((/** @type {any} */ item) => item.id),
    ['a2', 'a1', 'b1']
  );
});

test('CORAQuestionCard: boundary move buttons are disabled', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 0);
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  assert.equal(actions._children[0].disabled, true);
  assert.equal(actions._children[1].disabled, false);
});

test('CORAQuestionCard: duplicate inserts a copy with -copy id', () => {
  const bank = freshExampleReviewBank();
  const q = bank.questions[0];
  const e = mount(bank, 0);
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  const dupBtn = actions._children[3];
  const before = bank.questions.length;
  dupBtn._listeners.click[0]();
  assert.equal(bank.questions.length, before + 1);
  assert.equal(bank.questions[1].id, q.id + '-copy');
});

test('CORAQuestionCard: delete removes after confirm; cancelled confirm is a no-op', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 0);
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  const delBtn = actions._children[4];

  // Cancelled
  /** @type {any} */ (globalThis).confirm = () => false;
  const before = bank.questions.length;
  delBtn._listeners.click[0]();
  assert.equal(bank.questions.length, before);
  assert.equal(/** @type {any} */ (e.onCommit).calls, 0);

  // Confirmed
  /** @type {any} */ (globalThis).confirm = () => true;
  delBtn._listeners.click[0]();
  assert.equal(bank.questions.length, before - 1);
});

test('CORAQuestionCard: showWhen + active marks card-stripe with ochre', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 2); // q-resolve has showWhen
  const stripe = /** @type {any} */ (e)._children[0];
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
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  const delBtn = actions._children[4];
  delBtn._listeners.click[0](); // no throw; treated as cancel
  /** @type {any} */ (globalThis).confirm = () => true;
});

test('CORAQuestionCard: forwards bank state + onCommit to its child editors', () => {
  const bank = freshExampleReviewBank();
  const e = mount(bank, 0);
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const [wording, , options, labels, showwhen, remediation] = body._children;
  assert.equal(wording.onCommit, e.onCommit);
  assert.equal(wording.baselineQuestion.id, bank.questions[0].id);
  assert.equal(options.outcomeOptions, bank.outcomeOptions);
  assert.equal(options.onCommit, e.onCommit);
  assert.equal(labels.bank, bank);
  assert.equal(labels.onCommit, e.onCommit);
  assert.equal(showwhen.bankQuestions, bank.questions);
  assert.equal(showwhen.onCommit, e.onCommit);
  assert.equal(remediation.onCommit, e.onCommit);
});

test('CORAQuestionCard: question-group text commits and clears to undefined', () => {
  const bank = freshExampleReviewBank();
  const q = /** @type {any} */ (bank.questions[0]);
  const e = mount(bank, 0);
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const groupField = grid._children[1];
  const groupInput = groupField._children[1];
  groupInput._listeners.change[0]({ target: { value: 'Kick-off' } });
  assert.equal(q.questionGroup, 'Kick-off');
  groupInput._listeners.change[0]({ target: { value: '' } });
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
