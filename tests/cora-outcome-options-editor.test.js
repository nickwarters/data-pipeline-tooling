// @ts-check
import { resetStoreWithExampleReview } from './_bank-store-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORAOutcomeOptionsEditor } =
  await import('../src/question-bank/cora-outcome-options-editor.js');
const { _resetStore, cases } =
  await import('../src/question-bank/question-bank-store.js');

test('CORAOutcomeOptionsEditor: renders one row per case-type outcome option', () => {
  resetStoreWithExampleReview();
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  assert.equal(
    list._children.length,
    cases.get()['example-review'].outcomeOptions?.length
  );
});

test('CORAOutcomeOptionsEditor: edits the case-type default outcome', () => {
  resetStoreWithExampleReview();
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const defaultSelect = section._children[1]._children[0]._children[1];

  defaultSelect._listeners.change[0]({ target: { value: 'fail' } });

  assert.equal(cases.get()['example-review'].defaultOutcomeId, 'fail');
});

test('CORAOutcomeOptionsEditor: edits wording on the shared outcome option', () => {
  resetStoreWithExampleReview();
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  const firstRow = list._children[0];
  const wordingInput = firstRow._children[1]._children[1];

  wordingInput._listeners.change[0]({ target: { value: 'A' } });

  assert.equal(cases.get()['example-review'].outcomeOptions?.[0].wording, 'A');
});

test('CORAOutcomeOptionsEditor: edits severity on the shared outcome option', () => {
  resetStoreWithExampleReview();
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  const firstRow = list._children[0];
  const severityInput = firstRow._children[2]._children[1];

  severityInput._listeners.change[0]({ target: { value: '25' } });

  assert.equal(cases.get()['example-review'].outcomeOptions?.[0].severity, 25);
});

test('CORAOutcomeOptionsEditor: renaming an outcome id updates option-outcome mappings and the default', () => {
  resetStoreWithExampleReview();
  const bank = cases.get()['example-review'];
  bank.questions[0].optionOutcomes = { No: 'fail' };
  bank.questions[1].optionOutcomes = { No: 'fail', 'N/A': 'pass' };
  bank.defaultOutcomeId = 'fail';
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  const failIndex = bank.outcomeOptions?.findIndex((o) => o.id === 'fail');
  assert.notEqual(failIndex, -1);
  const failRow = list._children[/** @type {number} */ (failIndex)];
  const idInput = failRow._children[0]._children[1];

  idInput._listeners.change[0]({ target: { value: 'fail-impact' } });

  assert.equal(bank.questions[0].optionOutcomes?.No, 'fail-impact');
  assert.equal(bank.questions[1].optionOutcomes?.No, 'fail-impact');
  assert.equal(bank.questions[1].optionOutcomes?.['N/A'], 'pass');
  assert.equal(bank.defaultOutcomeId, 'fail-impact');
});

test('CORAOutcomeOptionsEditor: adds an outcome option to the active case type', () => {
  resetStoreWithExampleReview();
  const before = cases.get()['example-review'].outcomeOptions?.length ?? 0;
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const head = section._children[0];
  const add = head._children[1];

  add._listeners.click[0]();

  assert.equal(
    cases.get()['example-review'].outcomeOptions?.length,
    before + 1
  );
});

test('CORAOutcomeOptionsEditor: removes an outcome option', () => {
  resetStoreWithExampleReview();
  const bank = cases.get()['example-review'];
  const before = bank.outcomeOptions?.length ?? 0;
  bank.questions[0].optionOutcomes = { No: 'pass' };
  bank.questions[1].optionOutcomes = { No: 'pass', 'N/A': 'fail' };
  bank.defaultOutcomeId = 'pass';
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  const firstRow = list._children[0];
  const remove = firstRow._children[3];

  remove._listeners.click[0]();

  assert.equal(
    cases.get()['example-review'].outcomeOptions?.length,
    before - 1
  );
  // The sole mapping to the removed outcome is dropped, emptying the map.
  assert.equal(bank.questions[0].optionOutcomes, undefined);
  // A question that also mapped another option keeps that one.
  assert.deepEqual(bank.questions[1].optionOutcomes, { 'N/A': 'fail' });
  assert.equal(bank.defaultOutcomeId, undefined);
});
