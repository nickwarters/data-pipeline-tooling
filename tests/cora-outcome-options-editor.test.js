// @ts-check
import { resetStoreWithExampleReview } from './_bank-store-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';
installDom();

const { CORAOutcomeOptionsEditor } =
  await import('../src/pages/question-bank/cora-outcome-options-editor.js');
const { _resetStore, cases } =
  await import('../src/pages/question-bank/question-bank-store.js');

test('CORAOutcomeOptionsEditor: renders one row per case-type outcome option', () => {
  resetStoreWithExampleReview();
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  assert.equal(
    queryAllByRole(e, 'textbox', { name: 'Id' }).length,
    cases.get()['example-review'].outcomeOptions?.length
  );
});

test('CORAOutcomeOptionsEditor: edits the case-type default outcome', () => {
  resetStoreWithExampleReview();
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  fireEvent(getByRole(e, 'combobox', { name: 'Default outcome' }), 'change', {
    target: { value: 'fail' },
  });

  assert.equal(cases.get()['example-review'].defaultOutcomeId, 'fail');
});

test('CORAOutcomeOptionsEditor: edits wording on the shared outcome option', () => {
  resetStoreWithExampleReview();
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  fireEvent(queryAllByRole(e, 'textbox', { name: 'Wording' })[0], 'change', {
    target: { value: 'A' },
  });

  assert.equal(cases.get()['example-review'].outcomeOptions?.[0].wording, 'A');
});

test('CORAOutcomeOptionsEditor: edits severity on the shared outcome option', () => {
  resetStoreWithExampleReview();
  const e = new CORAOutcomeOptionsEditor();
  e.connectedCallback();
  fireEvent(queryAllByRole(e, 'textbox', { name: 'Severity' })[0], 'change', {
    target: { value: '25' },
  });

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
  const idInput = e.querySelector(
    '[data-focus-key="outcome:example-review:fail:id"]'
  );
  assert.ok(idInput);
  fireEvent(idInput, 'change', { target: { value: 'fail-impact' } });

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
  fireEvent(getByRole(e, 'button', { name: '+ outcome' }), 'click');

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
  fireEvent(queryAllByRole(e, 'button', { name: '×' })[0], 'click');

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
