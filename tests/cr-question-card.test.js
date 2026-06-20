// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CRQuestionCard } =
  await import('../src/components/cr-question-card.js');
const { _resetStore, cases, activeSlug } =
  await import('../src/question-bank/question-bank-store.js');

test('CRQuestionCard: no question → nothing renders', () => {
  const e = new CRQuestionCard();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CRQuestionCard: yes-no-na shows failure-criteria field + no options', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[0];
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[1];
  const body = head._children[1];
  // body kids: wording-editor, grid, showwhen-editor, remediation-editor
  // (no options-editor for yes-no-na)
  assert.equal(body._children.length, 4);
  // grid has 3 fields: category, response-type, failure-criteria
  const grid = body._children[1];
  assert.equal(grid._children.length, 3);
});

test('CRQuestionCard: single-choice renders options-editor + no failure-criteria', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[3]; // q-channel
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 3;
  e.connectedCallback();
  const body = /** @type {any} */ (e)._children[1]._children[1];
  // wording-editor, grid (2 fields), options-editor, showwhen, remediation
  assert.equal(body._children.length, 5);
});

test('CRQuestionCard: changing response-type to non-yes-no-na initialises options', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[0];
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const responseTypeField = grid._children[1];
  const select = responseTypeField._children[1];
  select._listeners.change[0]({ target: { value: 'single-choice' } });
  assert.deepEqual(q.options, ['Option A', 'Option B']);
});

test('CRQuestionCard: changing response-type to yes-no-na deletes options', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[3]; // q-channel single-choice
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 3;
  e.connectedCallback();
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const responseTypeField = grid._children[1];
  const select = responseTypeField._children[1];
  select._listeners.change[0]({ target: { value: 'yes-no-na' } });
  assert.equal('options' in q, false);
});

test('CRQuestionCard: id-input commits trimmed value (falls back to old on empty)', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[0];
  const oldId = q.id;
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  const head = /** @type {any} */ (e)._children[1];
  const num = head._children[0];
  const idInput = num._children[1];
  idInput._listeners.change[0]({ target: { value: '  q-new  ' } });
  assert.equal(q.id, 'q-new');
  idInput._listeners.change[0]({ target: { value: '   ' } });
  assert.equal(q.id, 'q-new'); // empty trim → fallback (oldId at that moment)
});

test('CRQuestionCard: category text commits to undefined when emptied', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[0];
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const catField = grid._children[0];
  const catInput = catField._children[1];
  catInput._listeners.change[0]({ target: { value: '' } });
  assert.equal(q.category, undefined);
});

test('CRQuestionCard: failure-criteria — selecting "—" clears the field', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[0]; // failureCriteria: 'No'
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  const body = /** @type {any} */ (e)._children[1]._children[1];
  const grid = body._children[1];
  const fcField = grid._children[2];
  const select = fcField._children[1];
  select._listeners.change[0]({ target: { value: '—' } });
  assert.equal(q.failureCriteria, undefined);
});

test('CRQuestionCard: deprecate / undeprecate icon toggles state', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[0];
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  const depBtn = actions._children[0];
  depBtn._listeners.click[0]();
  assert.equal(q.deprecated, true);
  depBtn._listeners.click[0]();
  assert.equal(q.deprecated, false);
});

test('CRQuestionCard: duplicate inserts a copy with -copy id', () => {
  _resetStore();
  activeSlug.set('hello-review');
  const q = cases.get()['hello-review'].questions[0];
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  const dupBtn = actions._children[1];
  const before = cases.get()['hello-review'].questions.length;
  dupBtn._listeners.click[0]();
  const after = cases.get()['hello-review'].questions.length;
  assert.equal(after, before + 1);
  assert.equal(cases.get()['hello-review'].questions[1].id, q.id + '-copy');
});

test('CRQuestionCard: delete removes after confirm; cancelled confirm is a no-op', () => {
  _resetStore();
  activeSlug.set('hello-review');
  const q = cases.get()['hello-review'].questions[0];
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  const delBtn = actions._children[2];

  // Cancelled
  /** @type {any} */ (globalThis).confirm = () => false;
  const before = cases.get()['hello-review'].questions.length;
  delBtn._listeners.click[0]();
  assert.equal(cases.get()['hello-review'].questions.length, before);

  // Confirmed
  /** @type {any} */ (globalThis).confirm = () => true;
  delBtn._listeners.click[0]();
  assert.equal(cases.get()['hello-review'].questions.length, before - 1);
});

test('CRQuestionCard: showWhen + active marks card-stripe with ochre', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[2]; // has showWhen
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 2;
  e.connectedCallback();
  const stripe = /** @type {any} */ (e)._children[0];
  assert.ok(stripe.style.cssText.includes('ochre'));
});

test('CRQuestionCard: deprecated adds "deprecated" class to the card', () => {
  _resetStore();
  const q = cases.get()['hello-review'].questions[0];
  q.deprecated = true;
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  assert.ok(e.className.includes('deprecated'));
});

test('CRQuestionCard: tolerates missing confirm() global', () => {
  _resetStore();
  /** @type {any} */ (globalThis).confirm = undefined;
  const q = cases.get()['hello-review'].questions[0];
  const e = new CRQuestionCard();
  e.question = q;
  e.questionIndex = 0;
  e.connectedCallback();
  const actions = /** @type {any} */ (e)._children[1]._children[2];
  const delBtn = actions._children[2];
  delBtn._listeners.click[0](); // no throw; treated as cancel
});
