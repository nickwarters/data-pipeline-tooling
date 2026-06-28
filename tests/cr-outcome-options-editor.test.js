// @ts-check
// TODO(simplify-ui): Rewrite these lifecycle-heavy tests around the
// future function-component API. Prefer asserting plain functions, h() output,
// reactive() updates, and route-shell behavior over manual connectedCallback()/
// disconnectedCallback() calls on custom element classes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_bank-dom-stub.js';
installDom();

const { CROutcomeOptionsEditor } =
  await import('../src/question-bank/cr-outcome-options-editor.js');
const { _resetStore, cases } =
  await import('../src/question-bank/question-bank-store.js');

test('CROutcomeOptionsEditor: renders one row per case-type outcome option', () => {
  _resetStore();
  const e = new CROutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  assert.equal(list._children.length, 2);
});

test('CROutcomeOptionsEditor: edits the case-type default outcome', () => {
  _resetStore();
  const e = new CROutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const defaultSelect = section._children[1]._children[0]._children[1];

  defaultSelect._listeners.change[0]({ target: { value: 'fail' } });

  assert.equal(cases.get()['example-review'].defaultOutcomeId, 'fail');
});

test('CROutcomeOptionsEditor: edits wording on the shared outcome option', () => {
  _resetStore();
  const e = new CROutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  const firstRow = list._children[0];
  const wordingInput = firstRow._children[1]._children[1];

  wordingInput._listeners.change[0]({ target: { value: 'A' } });

  assert.equal(cases.get()['example-review'].outcomeOptions?.[0].wording, 'A');
});

test('CROutcomeOptionsEditor: edits severity on the shared outcome option', () => {
  _resetStore();
  const e = new CROutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  const firstRow = list._children[0];
  const severityInput = firstRow._children[2]._children[1];

  severityInput._listeners.change[0]({ target: { value: '25' } });

  assert.equal(cases.get()['example-review'].outcomeOptions?.[0].severity, 25);
});

test('CROutcomeOptionsEditor: renaming an outcome id updates question and action references', () => {
  _resetStore();
  const bank = cases.get()['example-review'];
  bank.questions[0].outcome = { noActionOutcomeId: 'fail' };
  bank.questions[1].remediationActions = [
    { id: 'impact', text: 'Impact', outcomeId: 'fail' },
  ];
  bank.defaultOutcomeId = 'fail';
  const e = new CROutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  const failRow = list._children[1];
  const idInput = failRow._children[0]._children[1];

  idInput._listeners.change[0]({ target: { value: 'fail-impact' } });

  assert.equal(bank.questions[0].outcome?.noActionOutcomeId, 'fail-impact');
  assert.equal(
    /** @type {any} */ (bank.questions[1].remediationActions?.[0]).outcomeId,
    'fail-impact'
  );
  assert.equal(bank.defaultOutcomeId, 'fail-impact');
});

test('CROutcomeOptionsEditor: adds an outcome option to the active case type', () => {
  _resetStore();
  const before = cases.get()['example-review'].outcomeOptions?.length ?? 0;
  const e = new CROutcomeOptionsEditor();
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

test('CROutcomeOptionsEditor: removes an outcome option', () => {
  _resetStore();
  const bank = cases.get()['example-review'];
  bank.questions[0].outcome = { noActionOutcomeId: 'pass' };
  bank.defaultOutcomeId = 'pass';
  const e = new CROutcomeOptionsEditor();
  e.connectedCallback();
  const section = /** @type {any} */ (e)._children[0];
  const list = section._children[2];
  const firstRow = list._children[0];
  const remove = firstRow._children[3];

  remove._listeners.click[0]();

  assert.equal(cases.get()['example-review'].outcomeOptions?.length, 1);
  assert.equal(bank.questions[0].outcome, undefined);
  assert.equal(bank.defaultOutcomeId, undefined);
});
