// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
installDom();

const { CORARemediationEditor } =
  await import('../src/components/sections/cora-remediation-editor.js');
const { _resetStore } =
  await import('../src/question-bank/question-bank-store.js');

test('CORARemediationEditor: no question → renders nothing', () => {
  const e = new CORARemediationEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORARemediationEditor: empty actions + no free-form → empty hint', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const e = new CORARemediationEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  // h4, free-row, empty hint, add button
  assert.equal(wrap._children.length, 4);
  assert.equal(wrap._children[2].className, 'rem-empty');
});

test('CORARemediationEditor: actions + free-form preview show when toggle is on', () => {
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    allowFreeFormRemediation: true,
    remediationActions: ['A', 'B'],
  };
  const e = new CORARemediationEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  // h4, free-row, free-preview, 2 rem-items, add-btn
  assert.equal(wrap._children.length, 6);
});

test('CORARemediationEditor: free-form toggle flips state', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const e = new CORARemediationEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const freeRow = wrap._children[1];
  const toggle = freeRow._children[1];
  toggle._listeners.click[0]();
  assert.equal(q.allowFreeFormRemediation, true);
});

test('CORARemediationEditor: edit a remediation action via change event', () => {
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    remediationActions: ['Old action'],
  };
  const e = new CORARemediationEditor();
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

test('CORARemediationEditor: × removes action; deletes field when empty', () => {
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    remediationActions: ['only'],
  };
  const e = new CORARemediationEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const item = wrap._children[2];
  const x = item._children[2];
  x._listeners.click[0]();
  assert.equal('remediationActions' in q, false);
});

test('CORARemediationEditor: + canned action initialises array if missing', () => {
  /** @type {any} */
  const q = { id: 'q', text: '', responseType: 'yes-no-na', deprecated: false };
  const e = new CORARemediationEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const addBtn = wrap._children[wrap._children.length - 1];
  addBtn._listeners.click[0]();
  assert.deepEqual(q.remediationActions, [
    { id: 'q-ra-0', text: 'New action' },
  ]);
});

test('CORARemediationEditor: configures no-action outcome for failed questions', () => {
  _resetStore();
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  };
  const e = new CORARemediationEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const outcomeBlock = wrap._children[2];
  const select = outcomeBlock._children[1];

  select._listeners.change[0]({ target: { value: 'fail' } });

  assert.deepEqual(q.outcome, {
    noActionOutcomeId: 'fail',
  });
});

test('CORARemediationEditor: configures action-level outcome selection', () => {
  _resetStore();
  /** @type {any} */
  const q = {
    id: 'q',
    text: '',
    responseType: 'yes-no-na',
    deprecated: false,
    remediationActions: ['Legacy action'],
  };
  const e = new CORARemediationEditor();
  e.question = q;
  e.connectedCallback();
  const wrap = /** @type {any} */ (e)._children[0];
  const item = wrap._children[2];
  const select = item._children[1]._children[0];

  select._listeners.change[0]({ target: { value: 'fail' } });

  assert.deepEqual(q.remediationActions, [
    {
      id: 'q-ra-0',
      text: 'Legacy action',
      outcomeId: 'fail',
    },
  ]);
});
