// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { commitSpy } from './_example-review-fixture.js';
installDom();

const { CORARemediationActionsEditor } =
  await import('../src/pages/question-bank/cora-remediation-actions-editor.js');

test('CORARemediationActionsEditor: mutations flow through the onCommit prop', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const onCommit = commitSpy();
  const e = new CORARemediationActionsEditor();
  e.question = q;
  e.onCommit = onCommit;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const freeRow = wrap._children[1];
  const toggle = freeRow._children[1];
  toggle._listeners.click[0]();
  assert.equal(onCommit.calls, 1);
  assert.equal(q.allowFreeFormRemediation, true);

  const addBtn = wrap._children[wrap._children.length - 1];
  addBtn._listeners.click[0]();
  assert.equal(onCommit.calls, 2);
  assert.equal(q.remediationActions.length, 1);
});

test('CORARemediationActionsEditor: no question → renders nothing', () => {
  const e = new CORARemediationActionsEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORARemediationActionsEditor: empty actions + no free-form → empty hint', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const e = new CORARemediationActionsEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  // h4, free-row, empty hint, add button
  assert.equal(wrap._children.length, 4);
  assert.equal(wrap._children[2].className, 'cora-empty rem-empty');
});

test('CORARemediationActionsEditor: actions + free-form preview show when toggle is on', () => {
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    allowFreeFormRemediation: true,
    remediationActions: ['A', 'B'],
  };
  const e = new CORARemediationActionsEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  // h4, free-row, free-preview, 2 rem-items, add-btn
  assert.equal(wrap._children.length, 6);
});

test('CORARemediationActionsEditor: free-form toggle flips state', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const e = new CORARemediationActionsEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const freeRow = wrap._children[1];
  const toggle = freeRow._children[1];
  toggle._listeners.click[0]();
  assert.equal(q.allowFreeFormRemediation, true);
});

test('CORARemediationActionsEditor: edit a remediation action via change event', () => {
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    remediationActions: ['Old action'],
  };
  const e = new CORARemediationActionsEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const item = wrap._children[2]; // h4, free-row, item, add-btn
  const input = item._children[0];
  input._listeners.change[0]({ target: { value: 'New action' } });
  assert.deepEqual(q.remediationActions, [
    { id: 'q-ra-0', text: 'New action' },
  ]);
});

test('CORARemediationActionsEditor: × removes action; deletes field when empty', () => {
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    remediationActions: ['only'],
  };
  const e = new CORARemediationActionsEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const item = wrap._children[2];
  const x = item._children[1];
  x._listeners.click[0]();
  assert.equal('remediationActions' in q, false);
});

test('CORARemediationActionsEditor: + canned action initialises array if missing', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const e = new CORARemediationActionsEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const addBtn = wrap._children[wrap._children.length - 1];
  addBtn._listeners.click[0]();
  assert.deepEqual(q.remediationActions, [
    { id: 'q-ra-0', text: 'New action' },
  ]);
});

test('CORARemediationActionsEditor: failed questions get no Outcome selector (response drives outcome)', () => {
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  };
  const e = new CORARemediationActionsEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  // h4, free-row, empty hint, add button — no Outcome block.
  assert.equal(wrap._children.length, 4);
  assert.equal(wrap._children[2].className, 'cora-empty rem-empty');
  assert.equal('outcome' in q, false);
});

test('CORARemediationActionsEditor: an action row is just its text input and remove control', () => {
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    remediationActions: ['Legacy action'],
  };
  const e = new CORARemediationActionsEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const item = wrap._children[2];
  assert.equal(item._children.length, 2);
});
